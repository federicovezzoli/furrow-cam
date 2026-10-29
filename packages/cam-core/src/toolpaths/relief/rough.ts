import type { Model, Point, ReliefRoughOperation, Tool, TouchOffDisc } from "@furrow/document";
import type { Rect } from "../../geometry/bounds";
import { difference, intersection, offset, type Polygon } from "../../geometry/clipper";
import { DEFAULT_CHORD_TOLERANCE } from "../../geometry/flatten";
import { type Flip, modelView } from "../../scene/sides";
import type { Vec3 } from "../../scene/stock";
import { cutterProfile } from "../../simulation/simulation";
import type { ToolpathMessage } from "../messages";
import { type Descent, depthLevels, descend } from "../passes";
import { LevelClearing } from "../pocket/pocket";
import { type Toolpath, ToolpathBuilder, type ToolpathMove } from "../toolpath";
import { heightContours, simplifyContour } from "./contours";
import {
  coarsenedWarning,
  type FlatDisc,
  type HoldingTab,
  liftHeight,
  MAX_RELIEF_CELLS,
  modelHeightsSteps,
  NO_AREA_WARNING,
  outlineSpan,
  padDiscs,
  RELIEF_TOLERANCE,
  REST_MATERIAL,
  REST_MIN_WIDTH,
  type ReliefCache,
  type ReliefGrid,
  RestDropper,
  type RestOptions,
  type RestStock,
  reachModel,
  reliefCellSize,
  reliefFloor,
  reliefGrid,
  remainingRuns,
  restStockSteps,
  roughingArea,
  round3,
  simplifyHeights,
  ToolDropper,
  tabDiscs,
  toPassFrame,
  toStock,
  widened,
} from "./finish";

/**
 * 3D roughing (PRD-0005 S5, ADR-0030, ADR-0033): the material above a model,
 * offset by the stock to leave, cleared in Z levels.
 */

export type ReliefRoughOptions = {
  /** Retract height above the stock top. */
  safeZ: number;
  /** Height above the stock top where rapids down stop and feeding starts, capped at `safeZ`. */
  entryClearance: number;
  /** The stock seen from above, for the `stock` and `margin` boundaries. */
  stock: Rect | null;
  /** The stock's bottom, below which nothing is cut; `null` for no limit. */
  stockBottom?: number | null;
  /** A two-sided project's parting plane, below which this side cuts nothing around the model (ADR-0063); `null` for none. */
  parting?: number | null;
  /** On the bottom side, the flip to its stock coordinates; `null` on the top. */
  flip?: Flip | null;
  /** Chord tolerance for curves and offsets, in millimetres. */
  tolerance?: number;
  /** Model heightmaps kept between toolpaths. */
  cache?: ReliefCache;
  /** For rest machining (#118), what the earlier operations cut; `null` to cut everything. */
  rest?: RestOptions | null;
  /** The touch-off pad, an island at every level (#147); `null` for none. */
  touchOff?: TouchOffDisc | null;
  /** In a two-sided project, the holding tabs to leave, islands below their top (#357). */
  tabs?: readonly HoldingTab[];
};

/** Share of the progress the model heightmap takes; the levels take the rest. */
const HEIGHTMAP_SHARE = 0.4;

/** Of `HEIGHTMAP_SHARE`, what the rest stock takes, for rest operations. */
const REST_SHARE = 0.25;

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
 * boundary's `roughingArea`.
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
 *
 * With `rest` (S8), the stock the earlier operations left is simulated over
 * the grid and all the tool reaches from the area, and only material more
 * than `REST_MATERIAL` above a level, and wider than `REST_MIN_WIDTH`, is
 * cut: linear passes skip the samples
 * where the tool meets none, rapiding over the gaps, and pockets are cleared
 * only within reach of it.
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
    parting = null,
    flip = null,
    tolerance = DEFAULT_CHORD_TOLERANCE,
    cache,
    rest = null,
    touchOff = null,
    tabs = [],
  }: ReliefRoughOptions,
): Generator<number, Toolpath> {
  const { params } = operation;
  const { tool } = operation;
  const { strategy } = params;
  const warnings: ToolpathMessage[] = [];
  const wanted = reliefCellSize(tool);
  const radius = tool.diameter / 2;
  // Walls grow out by the stock to leave, and a tool centred outside the grid
  // mustn't reach them: the grid has room for both, and a cell more.
  const margin = params.stockToLeave + radius + wanted;
  const angle = strategy.type === "linear" ? strategy.angle : 0;
  const view = modelView(model, flip, parting);
  const grid = reliefGrid(view, angle, wanted, MAX_RELIEF_CELLS, margin);
  if (!grid) {
    return { moves: [], warnings: [NO_AREA_WARNING] };
  }
  if (grid.coarsened) warnings.push(coarsenedWarning(grid, wanted));
  const floor = reliefFloor(grid.base + params.stockToLeave, stockBottom, warnings);
  if (!(floor < 0)) {
    warnings.push({ code: "toolpath.roughNothing" });
    return { moves: [], warnings };
  }
  if (-floor > tool.fluteLength) warnings.push({ code: "toolpath.depthExceedsFlutes" });
  // Past the grid, no part of the model: the tool goes no lower than its cells there.
  const outsideFloor = Math.max(floor, grid.outside + params.stockToLeave);

  const heightsSteps = modelHeightsSteps(view, positions, grid, params.stockToLeave, cache);
  let heights: Float32Array;
  for (let step = heightsSteps.next(); ; step = heightsSteps.next()) {
    if (step.done) {
      heights = step.value;
      break;
    }
    yield (rest ? HEIGHTMAP_SHARE - REST_SHARE : HEIGHTMAP_SHARE) * step.value;
  }
  const tabsOnModel = reachModel(tabs, grid, heights);
  const area = roughingArea(params.boundary, view, stock, radius);
  if (!area) {
    warnings.push({ code: "toolpath.marginOffStock" });
    return { moves: [], warnings };
  }
  const restStock = rest
    ? yield* restStockSteps(
        grid,
        rest,
        stockBottom ?? grid.base,
        HEIGHTMAP_SHARE - REST_SHARE,
        HEIGHTMAP_SHARE,
        restCover(area, rest.stock, radius + wanted + 2 * restCellSize(grid)),
      )
    : null;
  if (restStock?.grid.coarsened) warnings.push(restCoarsenedWarning(restStock.grid));
  // Down to the cells outside the model first, so a level clears them flat (ADR-0063).
  const levels =
    outsideFloor > floor && outsideFloor < 0
      ? [
          ...depthLevels(-outsideFloor, tool.stepDown),
          ...depthLevels(outsideFloor - floor, tool.stepDown).map((z) => z + outsideFloor),
        ]
      : depthLevels(-floor, tool.stepDown);
  const progress = (i: number) =>
    HEIGHTMAP_SHARE + ((1 - HEIGHTMAP_SHARE) * (i + 1)) / levels.length;

  if (strategy.type === "linear") {
    const moves = yield* rasterLevels(tool, grid, heights, area, levels, floor, outsideFloor, {
      restStock,
      discs: [...padDiscs(touchOff, grid), ...tabDiscs(tabsOnModel, grid)],
      safeZ,
      entryClearance,
      ramp: params.ramp,
      stepOver: params.stepOver,
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
    {
      strategy,
      direction: params.direction,
      stepOver: params.stepOver,
      allowance: 0,
      ramp: params.ramp,
    },
    { safeZ, entryClearance, tolerance },
  );
  // The pad stays at the stock top: an island at every level, on its outside.
  const pad = touchOff && padPolygon(touchOff, tolerance);
  // Outlines are simplified within a cell and grown by two, so they still
  // hold every cell above the level: offsetting each step of a staircase
  // along the cells is slow.
  const simplification = Math.max(grid.cellWidth, grid.cellHeight);
  // Below `outsideFloor`, the tool's centre stays over the model (ADR-0063).
  const overModel =
    outsideFloor > floor
      ? offset(
          heightContours(heights, grid, -Infinity, grid.origin).map((ring) =>
            simplifyContour(ring, simplification),
          ),
          radius + 2 * simplification,
          { join: "miter", arcTolerance: tolerance },
        )
      : [];
  // The same warning from many levels is said once.
  const skipped = new Map<string, ToolpathMessage>();
  for (const [i, z] of levels.entries()) {
    const contours = heightContours(heights, grid, z, grid.origin).map((ring) =>
      simplifyContour(ring, simplification),
    );
    const islands = offset(contours, 2 * simplification, {
      join: "miter",
      arcTolerance: tolerance,
    });
    if (pad) islands.push(pad);
    for (const tab of tabsOnModel) if (z < tab.top) islands.push(tabPolygon(tab));
    // Islands may reach past the boundary; the pits inside them are cleared too.
    const within = z < outsideFloor ? intersection([boundary], overModel) : [boundary];
    let cleared = difference(within, islands);
    if (restStock) {
      // Only within reach of what is left that the tool can reach (the
      // pocket keeps its centre a radius inside), slivers narrower than
      // `REST_MIN_WIDTH` aside; a radius more brings the centre to it.
      const coarse = Math.max(restStock.grid.cellWidth, restStock.grid.cellHeight);
      const contours = heightContours(
        restStock.heights,
        restStock.grid,
        z + REST_MATERIAL,
        restStock.grid.origin,
      );
      const reachable = offset(offset(cleared, -radius, { arcTolerance: tolerance }), radius, {
        arcTolerance: tolerance,
      });
      const left = intersection(
        contours.map((ring) => simplifyContour(ring, coarse)),
        reachable,
      );
      const opened = offset(left, -REST_MIN_WIDTH / 2, { arcTolerance: tolerance });
      const reach = offset(opened, REST_MIN_WIDTH / 2 + 2 * radius, { arcTolerance: tolerance });
      cleared = intersection(cleared, reach);
    }
    for (const warning of clearing.clear(cleared, z)) skipped.set(JSON.stringify(warning), warning);
    yield progress(i);
  }
  return { moves: clearing.finish(), warnings: [...warnings, ...skipped.values()] };
}

/**
 * Where a rest roughing's stock left is simulated, besides the model's grid:
 * the `area` grown by `margin`, wherever the tool may reach from it (its
 * radius, the rest dropper's reach of a cell's diagonal and more), on the
 * stock, where earlier operations can have cut. Without a stock, nothing
 * past the model's grid: the stock is the model's outline (`roughingArea`).
 */
function restCover(area: Rect, stock: Rect | null, margin: number): Rect | null {
  if (!stock) return null;
  const min: Point = [
    Math.max(area.min[0] - margin, stock.min[0]),
    Math.max(area.min[1] - margin, stock.min[1]),
  ];
  const max: Point = [
    Math.min(area.max[0] + margin, stock.max[0]),
    Math.min(area.max[1] + margin, stock.max[1]),
  ];
  return min[0] < max[0] && min[1] < max[1] ? { min, max } : null;
}

/** The size of the rest grid's cells over `grid`, before coarsening (`restGrid`). */
function restCellSize(grid: ReliefGrid): number {
  return Math.max(grid.cellWidth, grid.cellHeight, REST_MIN_WIDTH / 2);
}

/** Says that the stock left is simulated on larger cells than `REST_MIN_WIDTH` needs. */
function restCoarsenedWarning(grid: ReliefGrid): ToolpathMessage {
  const size = Math.max(grid.cellWidth, grid.cellHeight);
  return {
    code: "toolpath.restCoarsened",
    values: { size: round3(size), width: round3(2 * size) },
  };
}

/** A holding tab as the rectangle it covers, counter-clockwise. */
function tabPolygon({ from, to, width }: HoldingTab): Polygon {
  const length = Math.hypot(to[0] - from[0], to[1] - from[1]) || 1;
  // Half the width across the strip.
  const nx = (-(to[1] - from[1]) / length) * (width / 2);
  const ny = ((to[0] - from[0]) / length) * (width / 2);
  return [
    [from[0] - nx, from[1] - ny],
    [to[0] - nx, to[1] - ny],
    [to[0] + nx, to[1] + ny],
    [from[0] + nx, from[1] + ny],
  ];
}

/**
 * The touch-off pad as a polygon around it, counter-clockwise, its sides
 * within `tolerance` of the circle and outside it, so a tool kept a radius
 * from the polygon never reaches the pad.
 */
export function padPolygon({ x, y, diameter }: TouchOffDisc, tolerance: number): Polygon {
  const r = diameter / 2;
  const sides = Math.max(16, Math.ceil(Math.PI / Math.acos(Math.max(-1, 1 - tolerance / r))));
  const corner = r / Math.cos(Math.PI / sides);
  return Array.from({ length: sides }, (_, i) => {
    const angle = (2 * Math.PI * i) / sides;
    return [x + corner * Math.cos(angle), y + corner * Math.sin(angle)];
  });
}

/** One straight pass along a row of the grid: the tip dropped onto the model at each sample. */
type RasterPass = {
  /** Height of the pass in the grid. */
  v: number;
  /** Column of the first sample; samples are at column centres, inside the grid or not. */
  first: number;
  /** The lowest the tip may go at each sample. */
  tips: Float64Array;
  /** For rest machining, the tip dropped onto the stock left at each sample. */
  stockTips: Float64Array | null;
};

type RasterOptions = {
  /** The stock the earlier operations left, for rest machining; `null` to cut everything. */
  restStock: RestStock | null;
  /** The touch-off pad in the grid's coordinates, which the tool rides over. */
  discs: FlatDisc[];
  safeZ: number;
  entryClearance: number;
  ramp: boolean;
  /** Percentage of the tool's diameter. */
  stepOver: number;
  /** The progress after level `i`. */
  progress: (i: number) => number;
};

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
  outsideFloor: number,
  { restStock, discs, safeZ, entryClearance, ramp, stepOver, progress }: RasterOptions,
): Generator<number, ToolpathMove[]> {
  const { columns, rows, cellWidth, cellHeight } = grid;
  // Samples are a cell apart, and links no further: between two of them the
  // tool mustn't meet what neither saw.
  const step = Math.max(cellWidth, cellHeight);
  const dropper = new ToolDropper(
    heights,
    grid,
    widened(cutterProfile(tool), step),
    discs,
    outsideFloor,
  );
  const restDropper = restStock ? new RestDropper(restStock, grid, cutterProfile(tool)) : null;
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
  const spacing = (tool.diameter * stepOver) / 100;
  const rowsApart = Math.max(1, Math.floor(spacing / cellHeight + 1e-9));
  const count = Math.ceil((lastRow - firstRow) / rowsApart) + 1;

  // Where the tool may go doesn't depend on the level: dropped once per pass.
  // Past the grid, no part of the model is in reach (its margin).
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
    const tips = new Float64Array(last - first + 1).fill(outsideFloor);
    const from = Math.max(first, 0);
    const to = Math.min(last, columns - 1);
    if (row >= 0 && row < rows && from <= to) {
      const inside = tips.subarray(from - first, to - first + 1).fill(floor);
      dropper.dropLine(v, from, to, inside);
    }
    // The pad may be past the grid, where the pass still goes.
    dropper.dropDiscs(v, first, last, tips);
    // Only stock more than `REST_MATERIAL` above the pass counts, so the tool
    // dropped onto it starts there, which spares scanning most cells. The
    // stock left is simulated over the whole area, past the grid too.
    const stockTips = restDropper ? tips.map((tip) => tip + REST_MATERIAL) : null;
    if (stockTips) restDropper?.dropLine(v, first, last, stockTips);
    passes.push({ v, first, tips, stockTips });
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
  /** Feeds along a run of a pass: heights `cuts` at `us`. */
  function cutRun(cuts: number[], us: number[], v: number) {
    for (const i of simplifyHeights(cuts, RELIEF_TOLERANCE)) {
      builder.feed(at(us[i] as number, v, cuts[i] as number), tool.feedRate);
    }
  }

  // Gaps narrower than the tool aren't worth leaving the cut for.
  const gap = Math.ceil(tool.diameter / cellWidth);
  let above = 0;
  for (const [level, z] of levels.entries()) {
    let previous: { u: number; v: number; z: number } | null = null;
    let reversed = false;
    for (const { v, first, tips, stockTips } of passes) {
      // Where the level above cut no lower than this one will, nothing is
      // left; nor where the earlier operations left nothing above the cut.
      const left = (i: number) =>
        (tips[i] as number) < above - SAME_HEIGHT &&
        (!stockTips || (stockTips[i] as number) > Math.max(z, tips[i] as number) + REST_MATERIAL);
      let runs: [number, number][];
      if (stockTips) runs = remainingRuns(left, tips.length, gap);
      else {
        let start = 0;
        while (start < tips.length && !left(start)) start++;
        let end = tips.length - 1;
        while (end >= start && !left(end)) end--;
        runs = start <= end ? [[start, end]] : [];
      }
      if (runs.length === 0) continue;
      const cutAt = (i: number) => Math.max(z, tips[i] as number);
      // Samples in the order the tool cuts them.
      const order = (i: number) => (reversed ? tips.length - 1 - i : i);
      if (reversed) {
        runs = runs
          .map(([a, b]): [number, number] => [tips.length - 1 - b, tips.length - 1 - a])
          .reverse();
      }
      const uAt = (k: number) => (first + order(k) + 0.5) * cellWidth;
      for (const [index, [a, b]] of runs.entries()) {
        const cuts = Array.from({ length: b - a + 1 }, (_, i) => cutAt(order(a + i)));
        const us = cuts.map((_, i) => uAt(a + i));
        const startU = us[0] as number;
        const startZ = cuts[0] as number;
        // What the earlier operations left under the whole tool at the start.
        const restTop = restDropper ? restDropper.highestUnder(startU, startU, v) : null;
        if (index > 0) {
          // Across the gap, clear of what is left there.
          const before = runs[index - 1]?.[1] as number;
          const lift = liftHeight(
            (restDropper as RestDropper).highestUnder(uAt(before), startU, v),
            cutAt,
            order(before),
            order(a),
            builder.clearance,
            safeZ,
          );
          const [x, y] = toStock(grid, uAt(before), v);
          builder.rapid([x, y, lift]);
        } else if (previous && Math.hypot(startU - previous.u, v - previous.v) <= maxLink) {
          // Straight to the next pass, riding on the model.
          const from = previous;
          const du = startU - from.u;
          const dv = v - from.v;
          const steps = Math.max(
            1,
            Math.ceil(Math.hypot(du, dv) / Math.min(cellWidth, cellHeight)),
          );
          const link = new Float64Array(steps + 1);
          link[0] = from.z;
          for (let k = 1; k < steps; k++) {
            const u = from.u + (du * k) / steps;
            const w = from.v + (dv * k) / steps;
            // Past the grid, only the pad is in reach.
            link[k] = Math.max(z, dropper.dropPoint(u, w, floor));
          }
          link[steps] = startZ;
          for (const k of simplifyHeights(link, RELIEF_TOLERANCE)) {
            if (k === 0) continue;
            const u = from.u + (du * k) / steps;
            builder.feed(at(u, from.v + (dv * k) / steps, link[k] as number), tool.feedRate);
          }
          cutRun(cuts, us, v);
          previous = { u: us.at(-1) as number, v, z: cuts.at(-1) as number };
          continue;
        }
        // Over the stock, down to what the level above (or an earlier
        // operation) cut, then into this one.
        const [x, y] = toStock(grid, startU, v);
        const top = Math.max(startZ, restTop === null ? above : Math.min(above, restTop));
        const entry =
          restTop === null
            ? builder.clearance
            : Math.min(builder.clearance, restTop + builder.clearance);
        if (index === 0) builder.travel(x, y);
        else builder.rapid([x, y, builder.position?.[2] ?? safeZ]);
        builder.rapid([x, y, Math.max(entry, top)]);
        builder.feed([x, y, top], tool.plungeRate);
        // Ramps along the start of the pass where it cuts at the level.
        let flat = 1;
        while (flat < cuts.length && cuts[flat] === z) flat++;
        const run = startZ === z ? us.slice(0, flat).map((u) => toStock(grid, u, v)) : [];
        descend(descent, run.length > 1 ? run : [[x, y]], top, startZ);
        cutRun(cuts, us, v);
        previous = { u: us.at(-1) as number, v, z: cuts.at(-1) as number };
      }
      reversed = !reversed;
    }
    above = z;
    yield progress(level);
  }
  builder.retract();
  return builder.moves;
}
