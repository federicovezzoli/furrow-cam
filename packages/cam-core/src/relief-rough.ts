import type { Model, ReliefRoughOperation, Tool } from "@furrow/document";
import type { Rect } from "./bounds";
import { DEFAULT_CHORD_TOLERANCE } from "./flatten";
import { difference, offset, type Polygon } from "./geometry";
import { heightContours, simplifyContour } from "./heightmap-contours";
import { modelRect } from "./model";
import { type Descent, depthLevels, descend } from "./passes";
import { LevelClearing } from "./pocket";
import {
  coarsenedWarning,
  MAX_RELIEF_CELLS,
  modelHeightsSteps,
  outlineSpan,
  RELIEF_TOLERANCE,
  type ReliefCache,
  type ReliefGrid,
  reliefCellSize,
  reliefFloor,
  reliefGrid,
  simplifyHeights,
  ToolDropper,
  toPassFrame,
  toStock,
} from "./relief";
import { type CutterProfile, cutterProfile } from "./simulation";
import type { Vec3 } from "./stock";
import { type Toolpath, ToolpathBuilder, type ToolpathMove } from "./toolpath";

/**
 * 3D roughing (PRD-0005 S5, ADR-0030, ADR-0033): the material above a model,
 * offset by the stock to leave, cleared in Z levels.
 */

export type ReliefRoughOptions = {
  /** Retract height above the stock top. */
  safeZ: number;
  /** Height above the stock top where rapids down stop and feeding starts, capped at `safeZ`. */
  entryClearance: number;
  /** The stock seen from above, for the `stock` boundary. */
  stock: Rect | null;
  /** The stock's bottom, below which nothing is cut; `null` for no limit. */
  stockBottom?: number | null;
  /** Chord tolerance for curves and offsets, in millimetres. */
  tolerance?: number;
  /** Model heightmaps kept between toolpaths. */
  cache?: ReliefCache;
};

/** Share of the progress the model heightmap takes; the levels take the rest. */
const HEIGHTMAP_SHARE = 0.4;

/**
 * The toolpath of a 3D roughing operation, in stock coordinates, yielding
 * the fraction done as it goes so a worker can report progress and stop
 * between steps.
 *
 * The model is rasterised with a margin of the stock to leave and the tool
 * radius around it, and offset by the stock to leave in every direction, as
 * for finishing. Levels go down from the stock top in equal steps no deeper
 * than the tool's step-down, to the model's bottom plus the stock to leave,
 * or the stock's bottom if that is higher. The tool's centre covers the
 * boundary: the model's outline or the whole stock.
 *
 * - Linear: straight passes at the strategy's angle, one step-over apart,
 *   at each level, the tool rising over the model where it is higher than
 *   the level (`rasterLevels`).
 * - Offset and peel: at each level, the cells of the offset model above it
 *   are islands, and the boundary less the islands is cleared like a pocket
 *   with the strategy, which keeps the tool a radius away from them. Lower
 *   levels only clear less, so the tool crosses what the level above cleared
 *   at that level's height.
 *
 * The step-over is the tool's unless the operation sets its own.
 */
export function* reliefRoughSteps(
  operation: ReliefRoughOperation,
  model: Model,
  positions: Float32Array,
  {
    safeZ,
    entryClearance,
    stock,
    stockBottom = null,
    tolerance = DEFAULT_CHORD_TOLERANCE,
    cache,
  }: ReliefRoughOptions,
): Generator<number, Toolpath> {
  const { params } = operation;
  const tool = { ...operation.tool, stepOver: params.stepOver ?? operation.tool.stepOver };
  const { strategy } = params;
  const warnings: string[] = [];
  const wanted = reliefCellSize(tool);
  const radius = tool.diameter / 2;
  // Walls grow out by the stock to leave, and a tool centred outside the grid
  // mustn't reach them: the grid has room for both, and a cell more.
  const margin = params.stockToLeave + radius + wanted;
  const angle = strategy.type === "linear" ? strategy.angle : 0;
  const grid = reliefGrid(model, angle, wanted, MAX_RELIEF_CELLS, margin);
  if (!grid) {
    return { moves: [], warnings: ["The model has no area seen from above to machine."] };
  }
  if (grid.coarsened) warnings.push(coarsenedWarning(grid, wanted));
  const floor = reliefFloor(grid.base + params.stockToLeave, stockBottom, warnings);
  if (!(floor < 0)) {
    warnings.push("The stock to leave covers the whole model: there is nothing to rough out.");
    return { moves: [], warnings };
  }
  if (-floor > tool.fluteLength) warnings.push("The depth exceeds the tool's flute length.");

  const heightsSteps = modelHeightsSteps(model, positions, grid, params.stockToLeave, cache);
  let heights: Float32Array;
  for (let step = heightsSteps.next(); ; step = heightsSteps.next()) {
    if (step.done) {
      heights = step.value;
      break;
    }
    yield HEIGHTMAP_SHARE * step.value;
  }

  const area = params.boundary === "stock" && stock ? stock : modelRect(model);
  const levels = depthLevels(-floor, tool.stepDown);
  const progress = (i: number) =>
    HEIGHTMAP_SHARE + ((1 - HEIGHTMAP_SHARE) * (i + 1)) / levels.length;

  if (strategy.type === "linear") {
    const moves = yield* rasterLevels(tool, grid, heights, area, levels, floor, {
      safeZ,
      entryClearance,
      ramp: params.ramp,
      progress,
    });
    return { moves, warnings };
  }

  // Grown by the radius, so the pocket's tool centre reaches the edges.
  const boundary: Polygon = [
    [area.min[0] - radius, area.min[1] - radius],
    [area.max[0] + radius, area.min[1] - radius],
    [area.max[0] + radius, area.max[1] + radius],
    [area.min[0] - radius, area.max[1] + radius],
  ];
  const clearing = new LevelClearing(
    tool,
    { strategy, direction: params.direction, allowance: 0, ramp: params.ramp },
    { safeZ, entryClearance, tolerance },
  );
  // Outlines are simplified within a cell and grown by two, so they still
  // hold every cell above the level: offsetting each step of a staircase
  // along the cells is slow.
  const simplification = Math.max(grid.cellWidth, grid.cellHeight);
  const skipped = new Set<string>();
  for (const [i, z] of levels.entries()) {
    const contours = heightContours(heights, grid, z, grid.origin).map((ring) =>
      simplifyContour(ring, simplification),
    );
    const islands = offset(contours, 2 * simplification, {
      join: "miter",
      arcTolerance: tolerance,
    });
    // Islands may reach past the boundary; the pits inside them are cleared too.
    const cleared = difference([boundary], islands);
    for (const warning of clearing.clear(cleared, z)) skipped.add(warning);
    yield progress(i);
  }
  return { moves: clearing.finish(), warnings: [...warnings, ...skipped] };
}

/** One straight pass along a row of the grid: the tip dropped onto the model at each sample. */
type RasterPass = {
  /** Height of the pass in the grid. */
  v: number;
  /** Column of the first sample; samples are at column centres, inside the grid or not. */
  first: number;
  /** The lowest the tip may go at each sample. */
  tips: Float64Array;
};

type RasterOptions = {
  safeZ: number;
  entryClearance: number;
  ramp: boolean;
  /** The progress after level `i`. */
  progress: (i: number) => number;
};

/**
 * `profile` reaching `by` further out, flat over its first `by`: dropped at
 * two points `by` apart, it keeps the straight move between them clear of
 * everything the true profile would touch along the way.
 */
function widened(profile: CutterProfile, by: number): CutterProfile {
  return {
    radius: profile.radius + by,
    flat: profile.flat,
    height: (distance) => profile.height(Math.max(0, distance - by)),
    reach: (depth) => profile.reach(depth) + by,
  };
}

/** Below this, a height is as low as another: `float32` heights round. */
const SAME_HEIGHT = 1e-6;

/**
 * Linear roughing: at each of `levels`, straight passes along the grid's rows
 * (the strategy's angle), one step-over apart at most, the tool's centre
 * covering `area`. Along a pass the tool cuts at the level, or rides on the
 * model where the tool dropped onto it is higher, so it never cuts below the
 * offset model (the tool is dropped widened by a sample's spacing, so the
 * moves between samples are clear too); where the level above already cut
 * as low as this one would,
 * the pass is trimmed. Passes zig-zag, linked by straight moves that ride on
 * the model too, unless the next pass is more than two tool diameters away:
 * then the tool retracts and enters again. Each entry comes down over the
 * stock to where the level above cut and goes down from there, ramping along
 * the pass where it runs flat for long enough.
 */
function* rasterLevels(
  tool: Tool,
  grid: ReliefGrid,
  heights: Float32Array,
  area: Rect,
  levels: number[],
  floor: number,
  { safeZ, entryClearance, ramp, progress }: RasterOptions,
): Generator<number, ToolpathMove[]> {
  const { columns, rows, cellWidth, cellHeight } = grid;
  // Samples are a cell apart, and links no further: between two of them the
  // tool mustn't meet what neither saw.
  const step = Math.max(cellWidth, cellHeight);
  const dropper = new ToolDropper(heights, grid, widened(cutterProfile(tool), step));
  const rect: [number, number][] = [
    [area.min[0], area.min[1]],
    [area.max[0], area.min[1]],
    [area.max[0], area.max[1]],
    [area.min[0], area.max[1]],
  ];
  const corners = rect.map((corner): [number, number] => {
    const [u, v] = toPassFrame(grid.angle, corner);
    return [u - grid.origin[0], v - grid.origin[1]];
  });
  const vs = corners.map(([, v]) => v);
  // Rows of cells, inside the grid or past it, whose centres are in the area.
  const firstRow = Math.ceil(Math.min(...vs) / cellHeight - 0.5 - 1e-9);
  const lastRow = Math.floor(Math.max(...vs) / cellHeight - 0.5 + 1e-9);
  const spacing = (tool.diameter * tool.stepOver) / 100;
  const rowsApart = Math.max(1, Math.floor(spacing / cellHeight + 1e-9));
  const count = Math.ceil((lastRow - firstRow) / rowsApart) + 1;

  // Where the tool may go doesn't depend on the level: dropped once per pass.
  // Past the grid, only cells at the model's bottom are in reach (its margin).
  const passes: RasterPass[] = [];
  let lastLine: number | null = null;
  for (let line = 0; line < count; line++) {
    const row =
      firstRow + (count > 1 ? Math.round((line * (lastRow - firstRow)) / (count - 1)) : 0);
    if (row === lastLine) continue;
    lastLine = row;
    const v = (row + 0.5) * cellHeight;
    const span = outlineSpan(corners, v);
    if (!span) continue;
    const first = Math.ceil(span[0] / cellWidth - 0.5 - 1e-9);
    const last = Math.floor(span[1] / cellWidth - 0.5 + 1e-9);
    if (first > last) continue;
    const tips = new Float64Array(last - first + 1).fill(floor);
    const from = Math.max(first, 0);
    const to = Math.min(last, columns - 1);
    if (row >= 0 && row < rows && from <= to) {
      dropper.dropLine(v, from, to, tips.subarray(from - first, to - first + 1));
    }
    passes.push({ v, first, tips });
  }

  const builder = new ToolpathBuilder(safeZ, entryClearance);
  const descent: Descent = {
    builder,
    plungeRate: tool.plungeRate,
    rampRun:
      ramp && tool.plungeAngle < 90 ? 1 / Math.tan((tool.plungeAngle * Math.PI) / 180) : null,
    minRampLength: tool.diameter / 2,
  };
  const maxLink = 2 * tool.diameter;
  const at = (u: number, v: number, z: number): Vec3 => [...toStock(grid, u, v), z];
  const inGrid = (u: number, v: number) =>
    u >= 0 && u <= columns * cellWidth && v >= 0 && v <= rows * cellHeight;

  let above = 0;
  for (const [level, z] of levels.entries()) {
    let previous: { u: number; v: number; z: number } | null = null;
    let reversed = false;
    for (const { v, first, tips } of passes) {
      // Where the level above cut no lower than this one will, nothing is left.
      const left = (i: number) => (tips[i] as number) < above - SAME_HEIGHT;
      let start = 0;
      while (start < tips.length && !left(start)) start++;
      if (start === tips.length) continue;
      let end = tips.length - 1;
      while (!left(end)) end--;
      const cuts = Array.from({ length: end - start + 1 }, (_, i) =>
        Math.max(z, tips[start + i] as number),
      );
      const us = cuts.map((_, i) => (first + start + i + 0.5) * cellWidth);
      if (reversed) {
        cuts.reverse();
        us.reverse();
      }
      const startU = us[0] as number;
      const startZ = cuts[0] as number;
      if (previous && Math.hypot(startU - previous.u, v - previous.v) <= maxLink) {
        // Straight to the next pass, riding on the model.
        const from = previous;
        const du = startU - from.u;
        const dv = v - from.v;
        const steps = Math.max(1, Math.ceil(Math.hypot(du, dv) / Math.min(cellWidth, cellHeight)));
        const link = new Float64Array(steps + 1);
        link[0] = from.z;
        for (let k = 1; k < steps; k++) {
          const u = from.u + (du * k) / steps;
          const w = from.v + (dv * k) / steps;
          link[k] = Math.max(z, inGrid(u, w) ? dropper.dropPoint(u, w, floor) : floor);
        }
        link[steps] = startZ;
        for (const k of simplifyHeights(link, RELIEF_TOLERANCE)) {
          if (k === 0) continue;
          const u = from.u + (du * k) / steps;
          builder.feed(at(u, from.v + (dv * k) / steps, link[k] as number), tool.feedRate);
        }
      } else {
        // Over the stock, down to what the level above cut, then into this one.
        const [x, y] = toStock(grid, startU, v);
        const top = Math.max(above, startZ);
        builder.travel(x, y);
        builder.rapid([x, y, Math.max(builder.clearance, top)]);
        builder.feed([x, y, top], tool.plungeRate);
        // Ramps along the start of the pass where it cuts at the level.
        let flat = 1;
        while (flat < cuts.length && cuts[flat] === z) flat++;
        const run = startZ === z ? us.slice(0, flat).map((u) => toStock(grid, u, v)) : [];
        descend(descent, run.length > 1 ? run : [[x, y]], top, startZ);
      }
      for (const i of simplifyHeights(cuts, RELIEF_TOLERANCE)) {
        builder.feed(at(us[i] as number, v, cuts[i] as number), tool.feedRate);
      }
      previous = { u: us.at(-1) as number, v, z: cuts.at(-1) as number };
      reversed = !reversed;
    }
    above = z;
    yield progress(level);
  }
  builder.retract();
  return builder.moves;
}
