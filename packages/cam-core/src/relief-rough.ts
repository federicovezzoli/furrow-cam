import type { Model, ReliefRoughOperation } from "@furrow/document";
import type { Rect } from "./bounds";
import { DEFAULT_CHORD_TOLERANCE } from "./flatten";
import { difference, offset, type Polygon } from "./geometry";
import { heightContours, simplifyContour } from "./heightmap-contours";
import { modelRect } from "./model";
import { depthLevels } from "./passes";
import { LevelClearing } from "./pocket";
import {
  coarsenedWarning,
  MAX_RELIEF_CELLS,
  modelHeightsSteps,
  type ReliefCache,
  reliefCellSize,
  reliefFloor,
  reliefGrid,
} from "./relief";
import type { Toolpath } from "./toolpath";

/**
 * 3D roughing (PRD-0005 S5, ADR-0030, ADR-0033): the material above a model,
 * offset by the stock to leave, cleared in Z levels with a pocket strategy.
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
 * The model is rasterised along the stock's axes, with a margin of the stock
 * to leave around it, and offset by the stock to leave in every direction,
 * as for finishing. Levels go down from the stock top in equal steps no
 * deeper than the tool's step-down, to the model's bottom plus the stock to
 * leave, or the stock's bottom if that is higher. At each level, the cells of the offset model above it are islands,
 * and the boundary (the model's outline or the whole stock, which the tool's
 * centre reaches) less the islands is cleared like a pocket with the
 * operation's strategy and step-over (the tool's unless it sets its own),
 * which keeps the tool a radius away from them. Lower
 * levels only clear less, so the tool crosses what the level above cleared
 * at that level's height.
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
  const { tool, params } = operation;
  const warnings: string[] = [];
  const wanted = reliefCellSize(tool);
  // Walls grow out by the stock to leave: the grid has room for that, and a cell more.
  const margin = params.stockToLeave + wanted;
  const grid = reliefGrid(model, 0, wanted, MAX_RELIEF_CELLS, margin);
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
  const radius = tool.diameter / 2;
  // Grown by the radius, so the pocket's tool centre reaches the edges.
  const boundary: Polygon = [
    [area.min[0] - radius, area.min[1] - radius],
    [area.max[0] + radius, area.min[1] - radius],
    [area.max[0] + radius, area.max[1] + radius],
    [area.min[0] - radius, area.max[1] + radius],
  ];
  const stepOver = params.stepOver ?? tool.stepOver;
  const clearing = new LevelClearing(
    { ...tool, stepOver },
    { strategy: params.strategy, direction: params.direction, allowance: 0, ramp: params.ramp },
    // Islands change at every level, so laps around them would stack into
    // rings; the passes reach the model, and finishing does the rest.
    { safeZ, entryClearance, tolerance, laps: false },
  );
  // Outlines are simplified within a cell and grown by two, so they still
  // hold every cell above the level: offsetting each step of a staircase
  // along the cells is slow.
  const simplification = Math.max(grid.cellWidth, grid.cellHeight);
  const skipped = new Set<string>();
  const levels = depthLevels(-floor, tool.stepDown);
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
    yield HEIGHTMAP_SHARE + ((1 - HEIGHTMAP_SHARE) * (i + 1)) / levels.length;
  }
  return { moves: clearing.finish(), warnings: [...warnings, ...skipped] };
}
