import type { Model, ReliefFinishOperation, Tool } from "@furrow/document";
import { rasterizeTriangles } from "./mesh-raster";
import { modelTransform, type PlacedModel, placedModelBox } from "./model";
import { type CutterProfile, cutterProfile, type HeightmapGrid } from "./simulation";
import type { Vec3 } from "./stock";
import { type Toolpath, ToolpathBuilder } from "./toolpath";

/**
 * Relief machining from a model heightmap (PRD-0005, ADR-0030, ADR-0032):
 * the placed mesh is rasterised into a grid of heights seen from above,
 * offset by the stock to leave, and the tool's profile is dropped onto it
 * along parallel passes. The grid is laid out in the passes' own frame, so
 * every pass runs along a row of cells whatever its angle.
 */

/** The largest cell a model is rasterised with, in millimetres (ADR-0030). */
export const RELIEF_CELL_SIZE = 0.1;

/** Cells across a tool's radius, when that makes them smaller than `RELIEF_CELL_SIZE`. */
export const RELIEF_CELLS_PER_RADIUS = 20;

/**
 * Most cells a model heightmap may have: 4096 × 4096, 64 MB of heights. It
 * never depends on the device, so a project gives the same G-code everywhere.
 */
export const MAX_RELIEF_CELLS = 4096 * 4096;

/**
 * How far above the dropped tool a pass may cut between the points it keeps:
 * passes are merged into straight moves that never go below the surface the
 * tool may reach, and leave at most this much more.
 */
export const RELIEF_TOLERANCE = 0.01;

/** The cell size `tool` wants: `RELIEF_CELL_SIZE`, or a twentieth of its radius if smaller. */
export function reliefCellSize(tool: Pick<Tool, "diameter">): number {
  return Math.min(RELIEF_CELL_SIZE, tool.diameter / 2 / RELIEF_CELLS_PER_RADIUS);
}

/**
 * The grid a model is rasterised into for passes at `angle`: cells over the
 * box around the model's outline in the passes' frame (the stock turned by
 * `-angle`), so cell `(column, row)` is centred at `origin + ((column + 0.5)
 * * cellWidth, (row + 0.5) * cellHeight)` in that frame. Cells outside the
 * outline, like those no triangle covers, stay at `base`, the model's bottom.
 */
export type ReliefGrid = HeightmapGrid & {
  /** Direction of the passes, in degrees counter-clockwise from the stock's X axis. */
  angle: number;
  /** The grid's corner in the passes' frame. */
  origin: [number, number];
  /** The model's outline in grid coordinates, its four corners in order. */
  outline: [number, number][];
  /** Height of the model's bottom, in stock coordinates. */
  base: number;
  /** Whether `MAX_RELIEF_CELLS` made the cells larger than wanted. */
  coarsened: boolean;
};

/**
 * The grid of `model` for passes at `angle`, with square-ish cells of
 * `cellSize`, larger if the model would take more than `maxCells`, and at
 * least two each way. It covers the model's outline grown by `margin` on
 * every side. `null` for a model with no area seen from above.
 */
export function reliefGrid(
  model: PlacedModel,
  angle: number,
  cellSize: number,
  maxCells = MAX_RELIEF_CELLS,
  margin = 0,
): ReliefGrid | null {
  const { min, max } = placedModelBox(model);
  if (!(max[0] > min[0] && max[1] > min[1])) return null;
  const [x0, y0, x1, y1] = [min[0] - margin, min[1] - margin, max[0] + margin, max[1] + margin];
  const corners: [number, number][] = [
    toPassFrame(angle, [x0, y0]),
    toPassFrame(angle, [x1, y0]),
    toPassFrame(angle, [x1, y1]),
    toPassFrame(angle, [x0, y1]),
  ];
  const us = corners.map(([u]) => u);
  const vs = corners.map(([, v]) => v);
  const origin: [number, number] = [Math.min(...us), Math.min(...vs)];
  const width = Math.max(...us) - origin[0];
  const length = Math.max(...vs) - origin[1];

  let size = cellSize;
  // Turning the outline leaves rounding errors that mustn't add a cell.
  const cells = (extent: number) => Math.ceil(extent / size - 1e-9);
  const wanted = cells(width) * cells(length);
  const coarsened = wanted > maxCells;
  if (coarsened) size *= Math.sqrt(wanted / maxCells);
  let columns = Math.max(2, cells(width));
  let rows = Math.max(2, cells(length));
  while (columns * rows > maxCells) {
    if (width / columns > length / rows) rows--;
    else columns--;
  }
  return {
    columns,
    rows,
    cellWidth: width / columns,
    cellHeight: length / rows,
    angle,
    origin,
    outline: corners.map(([u, v]) => [u - origin[0], v - origin[1]]),
    base: min[2],
    coarsened,
  };
}

/** The cosine and sine of `angle` in degrees, exact at quarter turns. */
function cosSin(angle: number): [number, number] {
  const radians = (angle * Math.PI) / 180;
  const exact = (value: number) => (Math.abs(value) < 1e-12 ? 0 : value);
  return [exact(Math.cos(radians)), exact(Math.sin(radians))];
}

/** A stock point in the passes' frame: turned by `-angle`. */
export function toPassFrame(angle: number, [x, y]: [number, number]): [number, number] {
  const [c, s] = cosSin(angle);
  return [c * x + s * y, -s * x + c * y];
}

/** A point of `grid` back in stock coordinates. */
export function toStock({ angle, origin }: ReliefGrid, u: number, v: number): [number, number] {
  const [c, s] = cosSin(angle);
  const pu = u + origin[0];
  const pv = v + origin[1];
  return [c * pu - s * pv, s * pu + c * pv];
}

/** The transform from the mesh's file coordinates to `grid`'s, as `modelTransform` gives it. */
export function reliefGridTransform(model: PlacedModel, grid: ReliefGrid): number[] {
  const m = modelTransform(model);
  const [c, s] = cosSin(grid.angle);
  const transform: number[] = [];
  for (let k = 0; k < 4; k++) {
    transform.push(
      c * (m[k] as number) + s * (m[4 + k] as number) - (k === 3 ? grid.origin[0] : 0),
    );
  }
  for (let k = 0; k < 4; k++) {
    transform.push(
      -s * (m[k] as number) + c * (m[4 + k] as number) - (k === 3 ? grid.origin[1] : 0),
    );
  }
  for (let k = 0; k < 4; k++) transform.push(m[8 + k] as number);
  return transform;
}

/** Triangles rasterised between two progress reports. */
const TRIANGLES_PER_STEP = 65_536;

/**
 * The highest point of the placed mesh over each cell of `grid`
 * (`rasterizeMesh`), a slice of triangles at a time, yielding the fraction
 * done after each.
 */
export function* rasterizeModelSteps(
  positions: Float32Array,
  model: PlacedModel,
  grid: ReliefGrid,
): Generator<number, Float32Array> {
  const heights = new Float32Array(grid.columns * grid.rows).fill(grid.base);
  const transform = reliefGridTransform(model, grid);
  const triangles = positions.length / 9;
  for (let first = 0; first < triangles; first += TRIANGLES_PER_STEP) {
    rasterizeTriangles(positions, transform, grid, heights, first, first + TRIANGLES_PER_STEP);
    yield Math.min(1, (first + TRIANGLES_PER_STEP) / triangles);
  }
  return heights;
}

/** Rows offset between two progress reports. */
const ROWS_PER_STEP = 32;

/**
 * `heights` offset by `distance` in every direction (ADR-0030): each cell
 * takes the highest `heights(q) + √(distance² − |q − p|²)` over the cells
 * `q` within `distance` of it, the top of the model grown by a sphere.
 * Steep and vertical walls move out by `distance` as well as up. Yields the
 * fraction done every few rows; returns `heights` itself for no distance.
 */
export function* offsetHeightsSteps(
  heights: Float32Array,
  grid: HeightmapGrid,
  distance: number,
): Generator<number, Float32Array> {
  if (!(distance > 0)) return heights;
  const { columns, rows, cellHeight } = grid;
  const sphere = cutterProfile({
    type: "ball_end_mill",
    diameter: 2 * distance,
    vAngle: null,
    tipDiameter: null,
  });
  const dropper = new ToolDropper(heights, grid, sphere);
  const offset = new Float32Array(columns * rows);
  const line = new Float64Array(columns);
  const floor = minimum(heights);
  for (let row = 0; row < rows; row++) {
    line.fill(floor);
    dropper.dropLine((row + 0.5) * cellHeight, 0, columns - 1, line);
    const start = row * columns;
    for (let column = 0; column < columns; column++) {
      offset[start + column] = (line[column] as number) + distance;
    }
    if ((row + 1) % ROWS_PER_STEP === 0) yield (row + 1) / rows;
  }
  return offset;
}

function minimum(values: Float32Array): number {
  let least = Infinity;
  for (let i = 0; i < values.length; i++) least = Math.min(least, values[i] as number);
  return least;
}

/**
 * Drops a tool's profile onto a heightmap: the tip height at a point `p` is
 * the highest `heights(q) − profile(|q − p|)` over the cells `q` within the
 * tool's radius, the lowest it can go without cutting into any of them.
 *
 * Along a line of points parallel to the rows, each row in reach meets the
 * tool's disc in a chord of the same width at every point. The highest
 * cell under each chord comes from a sliding maximum along the row; minus
 * the profile at the chord's middle (its lowest), it bounds what the row can
 * give. That is the exact answer for a flat tool; for the others, the
 * chord's cells are only scanned when the bound beats the best row so far,
 * nearest rows first.
 */
export class ToolDropper {
  private readonly window: Float64Array;
  private readonly deque: Int32Array;
  private readonly penalty: Float64Array;

  constructor(
    private readonly heights: Float32Array,
    private readonly grid: HeightmapGrid,
    private readonly profile: CutterProfile,
  ) {
    this.window = new Float64Array(grid.columns);
    this.deque = new Int32Array(grid.columns + 1);
    this.penalty = new Float64Array(Math.ceil(profile.radius / grid.cellWidth) + 2);
  }

  /**
   * Raises `out[i]` to the tip height at the centre of column `first + i`
   * on the line `y` (in grid coordinates), for columns `first` to `last`.
   * `out` starts at the lowest the tip may go.
   */
  dropLine(y: number, first: number, last: number, out: Float64Array) {
    const { heights, profile, window, penalty } = this;
    const { columns, rows, cellWidth, cellHeight } = this.grid;
    const radius = profile.radius;
    const firstRow = Math.max(0, Math.ceil((y - radius) / cellHeight - 0.5));
    const lastRow = Math.min(rows - 1, Math.floor((y + radius) / cellHeight - 0.5));
    const order: number[] = [];
    for (let row = firstRow; row <= lastRow; row++) order.push(row);
    const distance = (row: number) => Math.abs((row + 0.5) * cellHeight - y);
    order.sort((a, b) => distance(a) - distance(b));

    for (const row of order) {
      const dy = (row + 0.5) * cellHeight - y;
      const across2 = radius * radius - dy * dy;
      if (across2 < 0) continue;
      const reach = Math.floor(Math.sqrt(across2) / cellWidth + 1e-9);
      for (let k = 0; k <= reach; k++) penalty[k] = profile.height(Math.hypot(k * cellWidth, dy));
      const start = row * columns;
      slidingMaximum(heights, start, columns, first, last, reach, window, this.deque);
      const lowest = penalty[0] as number;
      if (profile.flat) {
        for (let i = 0; i <= last - first; i++) {
          const value = (window[i] as number) - lowest;
          if (value > (out[i] as number)) out[i] = value;
        }
        continue;
      }
      for (let i = 0; i <= last - first; i++) {
        let best = out[i] as number;
        if ((window[i] as number) - lowest <= best) continue;
        const column = first + i;
        const left = Math.min(reach, column);
        const right = Math.min(reach, columns - 1 - column);
        const at = start + column;
        for (let k = 1; k <= left; k++) {
          const value = (heights[at - k] as number) - (penalty[k] as number);
          if (value > best) best = value;
        }
        for (let k = 0; k <= right; k++) {
          const value = (heights[at + k] as number) - (penalty[k] as number);
          if (value > best) best = value;
        }
        out[i] = best;
      }
    }
  }

  /** The tip height at `[x, y]` (in grid coordinates), no lower than `floor`. */
  dropPoint(x: number, y: number, floor: number): number {
    const { heights, profile } = this;
    const { columns, rows, cellWidth, cellHeight } = this.grid;
    const radius = profile.radius;
    let best = floor;
    const firstRow = Math.max(0, Math.ceil((y - radius) / cellHeight - 0.5));
    const lastRow = Math.min(rows - 1, Math.floor((y + radius) / cellHeight - 0.5));
    const firstColumn = Math.max(0, Math.ceil((x - radius) / cellWidth - 0.5));
    const lastColumn = Math.min(columns - 1, Math.floor((x + radius) / cellWidth - 0.5));
    for (let row = firstRow; row <= lastRow; row++) {
      const dy = (row + 0.5) * cellHeight - y;
      for (let column = firstColumn; column <= lastColumn; column++) {
        const d = Math.hypot((column + 0.5) * cellWidth - x, dy);
        if (d > radius) continue;
        const value = (heights[row * columns + column] as number) - profile.height(d);
        if (value > best) best = value;
      }
    }
    return best;
  }
}

/**
 * `window[c − first]` = the highest of `values[start + j]` for `j` within
 * `reach` of `c` (and within the row), for `c` from `first` to `last`: a
 * monotonic queue of candidates, linear in the row's length.
 */
function slidingMaximum(
  values: Float32Array,
  start: number,
  columns: number,
  first: number,
  last: number,
  reach: number,
  window: Float64Array,
  deque: Int32Array,
) {
  let head = 0;
  let tail = 0;
  let next = Math.max(0, first - reach);
  for (let column = first; column <= last; column++) {
    const end = Math.min(columns - 1, column + reach);
    while (next <= end) {
      const value = values[start + next] as number;
      while (tail > head && (values[start + (deque[tail - 1] as number)] as number) <= value)
        tail--;
      deque[tail++] = next++;
    }
    while ((deque[head] as number) < column - reach) head++;
    window[column - first] = values[start + (deque[head] as number)] as number;
  }
}

/**
 * Of heights sampled at equal steps along a line, the indices to keep so the
 * straight moves between them never go below a sample and pass no more than
 * `tolerance` above any: each move runs as far as one slope fits every
 * sample on the way.
 */
export function simplifyHeights(heights: ArrayLike<number>, tolerance: number): number[] {
  const count = heights.length;
  if (count <= 2) return Array.from({ length: count }, (_, i) => i);
  const kept = [0];
  let anchor = 0;
  let low = -Infinity;
  let high = Infinity;
  for (let i = 1; i < count; i++) {
    const za = heights[anchor] as number;
    const steps = i - anchor;
    const slope = ((heights[i] as number) - za) / steps;
    if (steps > 1 && (slope < low - 1e-12 || slope > high + 1e-12)) {
      anchor = i - 1;
      kept.push(anchor);
      low = -Infinity;
      high = Infinity;
      i--;
      continue;
    }
    low = Math.max(low, slope);
    high = Math.min(high, ((heights[i] as number) + tolerance - za) / steps);
  }
  kept.push(count - 1);
  return kept;
}

/** Where a pass at `v` crosses `outline`, as the range of `u` inside it, or `null`. */
export function outlineSpan(outline: [number, number][], v: number): [number, number] | null {
  let low = Infinity;
  let high = -Infinity;
  for (let i = 0; i < outline.length; i++) {
    const [ua, va] = outline[i] as [number, number];
    const [ub, vb] = outline[(i + 1) % outline.length] as [number, number];
    if (Math.abs(va - vb) < 1e-9) {
      if (Math.abs(va - v) < 1e-9) {
        low = Math.min(low, ua, ub);
        high = Math.max(high, ua, ub);
      }
      continue;
    }
    if ((va - v) * (vb - v) > 0) continue;
    const u = ua + ((v - va) / (vb - va)) * (ub - ua);
    low = Math.min(low, u);
    high = Math.max(high, u);
  }
  return low <= high ? [low, high] : null;
}

/** Model heightmaps kept between toolpaths, by `reliefCacheKey`. */
export type ReliefCache = {
  get(key: string): Float32Array | undefined;
  set(key: string, heights: Float32Array): void;
};

/** A `ReliefCache` holding the last `capacity` heightmaps used. */
export function createReliefCache(capacity = 2): ReliefCache {
  const entries = new Map<string, Float32Array>();
  return {
    get(key) {
      const heights = entries.get(key);
      if (heights) {
        entries.delete(key);
        entries.set(key, heights);
      }
      return heights;
    },
    set(key, heights) {
      entries.delete(key);
      entries.set(key, heights);
      for (const oldest of entries.keys()) {
        if (entries.size <= capacity) break;
        entries.delete(oldest);
      }
    },
  };
}

/** Everything a model heightmap depends on: the mesh, its placement, the grid and the offset. */
export function reliefCacheKey(
  { sha256, bounds, placement }: Pick<Model, "sha256" | "bounds" | "placement">,
  { columns, rows, angle, origin }: ReliefGrid,
  offset: number,
): string {
  return JSON.stringify([sha256, bounds, placement, angle, origin, columns, rows, offset]);
}

/** The model heightmap offset by `offset`, from `cache` or computed (and cached), reporting progress. */
export function* modelHeightsSteps(
  model: Model,
  positions: Float32Array,
  grid: ReliefGrid,
  offset: number,
  cache: ReliefCache | undefined,
): Generator<number, Float32Array> {
  const key = reliefCacheKey(model, grid, offset);
  const cached = cache?.get(key);
  if (cached) return cached;
  const rawKey = reliefCacheKey(model, grid, 0);
  let raw = cache?.get(rawKey);
  if (!raw) {
    const rasterize = rasterizeModelSteps(positions, model, grid);
    for (let step = rasterize.next(); ; step = rasterize.next()) {
      if (step.done) {
        raw = step.value;
        break;
      }
      yield step.value * (offset > 0 ? 0.3 : 1);
    }
    cache?.set(rawKey, raw);
  }
  if (!(offset > 0)) return raw;
  const grow = offsetHeightsSteps(raw, grid, offset);
  for (let step = grow.next(); ; step = grow.next()) {
    if (step.done) {
      cache?.set(key, step.value);
      return step.value;
    }
    yield 0.3 + 0.7 * step.value;
  }
}

export type ReliefFinishOptions = {
  /** Retract height above the stock top. */
  safeZ: number;
  /** Height above the stock top where rapids down stop and feeding starts, capped at `safeZ`. */
  entryClearance: number;
  /** The stock's bottom, below which nothing is cut; `null` for no limit. */
  stockBottom?: number | null;
  /** Model heightmaps kept between toolpaths. */
  cache?: ReliefCache;
};

/** Share of the progress the model heightmap takes; the passes take the rest. */
const HEIGHTMAP_SHARE = 0.4;

/**
 * The toolpath of a 3D finishing operation (PRD-0005 S4, ADR-0030), in stock
 * coordinates, yielding the fraction done as it goes so a worker can report
 * progress and stop between steps.
 *
 * Passes at the operation's angle and step-over cover the model's outline
 * with the tool's centre, from edge to edge. Along each pass the tool is
 * dropped onto the model, offset by the stock to leave, at every cell, and
 * the points are merged into straight moves within `RELIEF_TOLERANCE`.
 * One-way passes all cut in the same direction, retracting between them;
 * zig-zag passes alternate, linked by a move that follows the model.
 * Each pass starts with a rapid down to the entry clearance above the stock
 * top and a plunge at the tool's plunge rate, which is safe whether or not
 * the model was roughed out; the passes themselves cut at its feed rate.
 */
export function* reliefFinishSteps(
  operation: ReliefFinishOperation,
  model: Model,
  positions: Float32Array,
  { safeZ, entryClearance, stockBottom = null, cache }: ReliefFinishOptions,
): Generator<number, Toolpath> {
  const { tool, params } = operation;
  const warnings: string[] = [];
  const wanted = reliefCellSize(tool);
  const grid = reliefGrid(model, params.angle, wanted);
  if (!grid) {
    return { moves: [], warnings: ["The model has no area seen from above to machine."] };
  }
  if (grid.coarsened) warnings.push(coarsenedWarning(grid, wanted));

  const heightsSteps = modelHeightsSteps(model, positions, grid, params.stockToLeave, cache);
  let heights: Float32Array;
  for (let step = heightsSteps.next(); ; step = heightsSteps.next()) {
    if (step.done) {
      heights = step.value;
      break;
    }
    yield HEIGHTMAP_SHARE * step.value;
  }

  const { columns, rows, cellWidth, cellHeight } = grid;
  const dropper = new ToolDropper(heights, grid, cutterProfile(tool));
  const floor = reliefFloor(grid.base + params.stockToLeave, stockBottom, warnings);
  // Passes run along row centres, where the heights are exact: from the
  // first row to the last, evenly spread, no more rows apart than fit in the
  // step-over, so rounding never spreads them further.
  const spacing = (tool.diameter * params.stepOver) / 100;
  const rowsApart = Math.max(1, Math.floor(spacing / cellHeight + 1e-9));
  const count = Math.ceil((rows - 1) / rowsApart) + 1;
  let lastRow = -1;
  const tips = new Float64Array(columns);
  const builder = new ToolpathBuilder(safeZ, entryClearance);
  const zigzag = params.direction === "zigzag";
  let previous: { u: number; v: number; z: number } | null = null;
  let reversed = false;

  const at = (u: number, v: number, z: number): Vec3 => [...toStock(grid, u, v), z];
  function startPass([x, y, z]: Vec3) {
    builder.travel(x, y);
    builder.rapid([x, y, Math.max(builder.clearance, z)]);
    builder.feed([x, y, z], tool.plungeRate);
  }

  for (let line = 0; line < count; line++) {
    const row = count > 1 ? Math.round((line * (rows - 1)) / (count - 1)) : 0;
    if (row === lastRow) continue;
    lastRow = row;
    const v = (row + 0.5) * cellHeight;
    const span = outlineSpan(grid.outline, v);
    const first = span ? Math.max(0, Math.ceil(span[0] / cellWidth - 0.5)) : 1;
    const last = span ? Math.min(columns - 1, Math.floor(span[1] / cellWidth - 0.5)) : 0;
    if (first <= last) {
      const samples = last - first + 1;
      const pass = tips.subarray(0, samples);
      pass.fill(floor);
      dropper.dropLine(v, first, last, pass);
      if (reversed) pass.reverse();
      const kept = simplifyHeights(pass, RELIEF_TOLERANCE);
      const u = (i: number) => ((reversed ? last - i : first + i) + 0.5) * cellWidth;
      const startU = u(0);
      if (previous && zigzag) {
        // A link that follows the model to the next pass.
        const du = startU - previous.u;
        const dv = v - previous.v;
        const steps = Math.max(1, Math.ceil(Math.hypot(du, dv) / Math.min(cellWidth, cellHeight)));
        const link = new Float64Array(steps + 1);
        link[0] = previous.z;
        for (let k = 1; k < steps; k++) {
          link[k] = dropper.dropPoint(
            previous.u + (du * k) / steps,
            previous.v + (dv * k) / steps,
            floor,
          );
        }
        link[steps] = pass[0] as number;
        for (const k of simplifyHeights(link, RELIEF_TOLERANCE)) {
          if (k === 0) continue;
          const point = at(
            previous.u + (du * k) / steps,
            previous.v + (dv * k) / steps,
            link[k] as number,
          );
          builder.feed(point, tool.feedRate);
        }
      } else {
        startPass(at(startU, v, pass[0] as number));
      }
      for (const i of kept) builder.feed(at(u(i), v, pass[i] as number), tool.feedRate);
      previous = { u: u(samples - 1), v, z: pass[samples - 1] as number };
      if (zigzag) reversed = !reversed;
    }
    yield HEIGHTMAP_SHARE + ((1 - HEIGHTMAP_SHARE) * (line + 1)) / count;
  }
  builder.retract();
  return { moves: builder.moves, warnings };
}

/**
 * The lowest a 3D operation cuts: the model's bottom plus the stock to leave,
 * `lowest`, but no lower than the stock's bottom, saying so in `warnings`
 * (ADR-0034): a model deeper than the stock is cut off there.
 */
export function reliefFloor(
  lowest: number,
  stockBottom: number | null,
  warnings: string[],
): number {
  if (stockBottom === null || lowest >= stockBottom) return lowest;
  warnings.push("The model reaches below the stock: it is cut no deeper than the stock's bottom.");
  return stockBottom;
}

/** Says that `grid` has larger cells than the `wanted` size. */
export function coarsenedWarning(grid: ReliefGrid, wanted: number): string {
  const size = Math.max(grid.cellWidth, grid.cellHeight);
  return `The model is too large to machine at full resolution with this tool: it is cut with cells of ${size.toFixed(3)} mm instead of ${wanted.toFixed(3)} mm.`;
}

/** Runs `steps` to the end, ignoring the progress it reports. */
export function runSteps<T>(steps: Generator<number, T>): T {
  for (;;) {
    const step = steps.next();
    if (step.done) return step.value;
  }
}
