import type {
  FinishingStrategy,
  Model,
  Point,
  ReliefFinishOperation,
  ReliefFinishParams,
  RoughingBoundary,
  Tool,
  TouchOffDisc,
} from "@furrow/document";
import { composeAffine } from "../../geometry/affine";
import type { Rect } from "../../geometry/bounds";
import { boxRect } from "../../scene/model";
import { type Flip, type ModelView, modelView } from "../../scene/sides";
import type { Vec3 } from "../../scene/stock";
import {
  type CutterProfile,
  cutterProfile,
  type HeightmapGrid,
  type SimulationCut,
  sweepMoves,
} from "../../simulation/simulation";
import type { ToolpathMessage } from "../messages";
import { type Toolpath, ToolpathBuilder } from "../toolpath";
import { rasterizeTriangles } from "./mesh-raster";

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
 * outline, like those no triangle covers, are at `-Infinity`: no part of the
 * model is there, and a tool centred over them goes no lower than `outside`.
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
  /** Height of the cells no part of the model is over (`ModelView.outside`). */
  outside: number;
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
  model: Pick<ModelView, "box"> & Partial<Pick<ModelView, "outside">>,
  angle: number,
  cellSize: number,
  maxCells = MAX_RELIEF_CELLS,
  margin = 0,
): ReliefGrid | null {
  const { min, max } = model.box;
  if (!(max[0] > min[0] && max[1] > min[1])) return null;
  const grown: Rect = {
    min: [min[0] - margin, min[1] - margin],
    max: [max[0] + margin, max[1] + margin],
  };
  const corners = rectCorners(grown).map((corner) => toPassFrame(angle, corner));
  const box = boxAround(corners);
  const origin: [number, number] = [box.min[0], box.min[1]];
  const width = box.max[0] - origin[0];
  const length = box.max[1] - origin[1];
  const { columns, rows, coarsened } = gridCells(width, length, cellSize, maxCells);
  return {
    columns,
    rows,
    cellWidth: width / columns,
    cellHeight: length / rows,
    angle,
    origin,
    outline: corners.map(([u, v]) => [u - origin[0], v - origin[1]]),
    base: min[2],
    outside: model.outside ?? min[2],
    coarsened,
  };
}

/**
 * How many square-ish cells of `size` cover `width` × `length`: larger ones
 * (`coarsened`) if there would be more than `maxCells`, at least two each way.
 */
function gridCells(
  width: number,
  length: number,
  size: number,
  maxCells: number,
): { columns: number; rows: number; coarsened: boolean } {
  // Turning a rectangle leaves rounding errors that mustn't add a cell.
  const cells = (extent: number, cell: number) => Math.ceil(extent / cell - 1e-9);
  const wanted = cells(width, size) * cells(length, size);
  const coarsened = wanted > maxCells;
  const cell = coarsened ? size * Math.sqrt(wanted / maxCells) : size;
  let columns = Math.max(2, cells(width, cell));
  let rows = Math.max(2, cells(length, cell));
  while (columns * rows > maxCells) {
    if (width / columns > length / rows) rows--;
    else columns--;
  }
  return { columns, rows, coarsened };
}

/** The four corners of `rect`, counter-clockwise from its minimum. */
function rectCorners({ min, max }: Rect): [number, number][] {
  return [
    [min[0], min[1]],
    [max[0], min[1]],
    [max[0], max[1]],
    [min[0], max[1]],
  ];
}

/** The axis-aligned box around `points`. */
function boxAround(points: [number, number][]): Rect {
  const us = points.map(([u]) => u);
  const vs = points.map(([, v]) => v);
  return { min: [Math.min(...us), Math.min(...vs)], max: [Math.max(...us), Math.max(...vs)] };
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

/** The transform from the mesh's file coordinates to `grid`'s, given `placed`, the one to stock coordinates (`modelTransform`, or `bottomModelTransform` seen from below). */
export function reliefGridTransform(placed: readonly number[], grid: ReliefGrid): number[] {
  const [c, s] = cosSin(grid.angle);
  return composeAffine([c, s, 0, -grid.origin[0], -s, c, 0, -grid.origin[1], 0, 0, 1, 0], placed);
}

/** Triangles rasterised between two progress reports. */
const TRIANGLES_PER_STEP = 65_536;

/**
 * The highest point of the placed mesh over each cell of `grid`
 * (`rasterizeMesh`), a slice of triangles at a time, yielding the fraction
 * done after each. Cells no triangle covers are at `-Infinity`.
 */
export function* rasterizeModelSteps(
  positions: Float32Array,
  model: Pick<ModelView, "transform">,
  grid: ReliefGrid,
): Generator<number, Float32Array> {
  const heights = new Float32Array(grid.columns * grid.rows).fill(-Infinity);
  const transform = reliefGridTransform(model.transform, grid);
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
    taperAngle: null,
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

  /**
   * `discs` are flat-topped raised discs the tool is dropped onto too,
   * wherever they are, inside the grid or past it (the touch-off pad).
   * `outside` is the lowest the tip goes with its centre over no part of the
   * model, a cell at `-Infinity` or past the grid: a two-sided project's
   * parting plane (ADR-0063). The tool may still reach past the model's
   * outline from over it.
   */
  constructor(
    private readonly heights: Float32Array,
    private readonly grid: HeightmapGrid,
    private readonly profile: CutterProfile,
    private readonly discs: readonly FlatDisc[] = [],
    private readonly outside = -Infinity,
  ) {
    this.window = new Float64Array(grid.columns);
    this.deque = new Int32Array(grid.columns + 1);
    this.penalty = new Float64Array(Math.ceil(profile.radius / grid.cellWidth) + 2);
  }

  /**
   * Raises `out[i]` to the tip height at the centre of column `first + i`
   * on the line `y` (in grid coordinates), for columns `first` to `last`,
   * inside the grid or past it. `out` starts at the lowest the tip may go.
   */
  dropLine(y: number, first: number, last: number, out: Float64Array) {
    const { columns } = this.grid;
    // Past the grid, only the discs are in reach: a grid has a margin round
    // the model wherever a pass goes past it.
    const from = Math.max(first, 0);
    const to = Math.min(last, columns - 1);
    if (from <= to) this.dropRows(y, from, to, out.subarray(from - first, to - first + 1));
    this.dropDiscs(y, first, last, out);
    if (this.outside === -Infinity) return;
    const row = Math.floor(y / this.grid.cellHeight);
    for (let i = 0; i <= last - first; i++) {
      if ((out[i] as number) < this.outside && this.empty(first + i, row)) out[i] = this.outside;
    }
  }

  /** `dropLine` over the model's cells alone, for columns `first` to `last` of the grid. */
  private dropRows(y: number, first: number, last: number, out: Float64Array) {
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

  /** Whether no part of the model is over cell `(column, row)`, inside the grid or past it. */
  private empty(column: number, row: number): boolean {
    const { columns, rows } = this.grid;
    if (column < 0 || column >= columns || row < 0 || row >= rows) return true;
    return this.heights[row * columns + column] === -Infinity;
  }

  /**
   * Raises `out[i]` to the tip height over the `discs` alone at the centre of
   * column `first + i` on the line `y`, for any columns, inside the grid or
   * past it: the highest point of a disc under the tool is where it is
   * nearest the tool's axis.
   */
  dropDiscs(y: number, first: number, last: number, out: Float64Array) {
    const { profile, discs } = this;
    const { cellWidth } = this.grid;
    for (const disc of discs) {
      const ys = [disc.y, disc.to?.[1] ?? disc.y];
      const reach = disc.radius + profile.radius;
      if (y < Math.min(...ys) - reach || y > Math.max(...ys) + reach) continue;
      for (let i = 0; i <= last - first; i++) {
        const distance = discDistance(disc, (first + i + 0.5) * cellWidth, y);
        if (distance > profile.radius) continue;
        const value = disc.top - profile.height(Math.max(0, distance));
        if (value > (out[i] as number)) out[i] = value;
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
    const radius2 = radius * radius;
    for (let row = firstRow; row <= lastRow; row++) {
      const dy = (row + 0.5) * cellHeight - y;
      const dy2 = dy * dy;
      if (dy2 > radius2) continue;
      const start = row * columns;
      for (let column = firstColumn; column <= lastColumn; column++) {
        const cell = heights[start + column] as number;
        // The profile is never below the tip: a cell no higher can't win.
        if (cell <= best) continue;
        const dx = (column + 0.5) * cellWidth - x;
        const d2 = dx * dx + dy2;
        if (d2 > radius2) continue;
        const value = cell - profile.height(Math.sqrt(d2));
        if (value > best) best = value;
      }
    }
    for (const disc of this.discs) {
      const distance = discDistance(disc, x, y);
      if (distance > radius) continue;
      best = Math.max(best, disc.top - profile.height(Math.max(0, distance)));
    }
    if (best < this.outside && this.empty(Math.floor(x / cellWidth), Math.floor(y / cellHeight))) {
      return this.outside;
    }
    return best;
  }
}

/**
 * A flat-topped raised disc in a grid's coordinates, its top at `top`, or
 * with `to`, the disc swept from its centre to there: a holding tab (#357).
 */
export type FlatDisc = { x: number; y: number; radius: number; top: number; to?: [number, number] };

/** How far `[x, y]` is outside `disc`, negative inside it. */
function discDistance({ x: ax, y: ay, radius, to }: FlatDisc, x: number, y: number): number {
  const [bx, by] = to ?? [ax, ay];
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared > 0
      ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / lengthSquared))
      : 0;
  return Math.hypot(x - ax - t * dx, y - ay - t * dy) - radius;
}

/**
 * A two-sided project's holding tab (PRD-0011 B5, ADR-0063) on the model
 * `modelId`, in the stock coordinates of the side cutting round it: a strip
 * `width` wide from `from`, on the model's outline, out to `to`, which the
 * tool cuts no lower than `top` over.
 */
export type HoldingTab = { modelId: string; from: Point; to: Point; width: number; top: number };

/**
 * `tabs` carried on inward from the model's outline to the first cell of
 * `heights` with model under it, so a tab reaches the model's surface but
 * bridges no hole or pocket further in (#357). A tab whose way in meets no
 * part of the model is left as it is.
 */
export function reachModel(
  tabs: readonly HoldingTab[],
  grid: ReliefGrid,
  heights: Float32Array,
): HoldingTab[] {
  const { columns, rows, cellWidth, cellHeight } = grid;
  const step = Math.min(cellWidth, cellHeight);
  const steps = Math.ceil(Math.hypot(columns * cellWidth, rows * cellHeight) / step);
  return tabs.map((tab) => {
    const [fu, fv] = toPassFrame(grid.angle, tab.from);
    const [tu, tv] = toPassFrame(grid.angle, tab.to);
    const length = Math.hypot(fu - tu, fv - tv);
    if (length === 0) return tab;
    // Inwards, in the grid's coordinates.
    const [du, dv] = [(fu - tu) / length, (fv - tv) / length];
    for (let k = 0; k <= steps; k++) {
      const u = fu - grid.origin[0] + du * k * step;
      const v = fv - grid.origin[1] + dv * k * step;
      // On a cell edge, the cell inwards: the outline is the grid's edge in finishing.
      const column = Math.floor(u / cellWidth + du * 1e-9);
      const row = Math.floor(v / cellHeight + dv * 1e-9);
      if (column < 0 || column >= columns || row < 0 || row >= rows) continue;
      if (heights[row * columns + column] === -Infinity) continue;
      return k === 0 ? tab : { ...tab, from: toStock(grid, u, v) };
    }
    return tab;
  });
}

/** `tabs` as swept discs in `grid`'s coordinates, for dropping tools onto. */
export function tabDiscs(tabs: readonly HoldingTab[], grid: ReliefGrid): FlatDisc[] {
  const inGrid = (point: Point): [number, number] => {
    const [u, v] = toPassFrame(grid.angle, point);
    return [u - grid.origin[0], v - grid.origin[1]];
  };
  return tabs.map(({ from, to, width, top }) => {
    const [x, y] = inGrid(from);
    return { x, y, to: inGrid(to), radius: width / 2, top };
  });
}

/**
 * The touch-off pad as a disc in `grid`'s coordinates, its top at the stock
 * top, for dropping tools onto (ADR-0041); none without a pad.
 */
export function padDiscs(touchOff: TouchOffDisc | null, grid: ReliefGrid): FlatDisc[] {
  if (!touchOff) return [];
  const [u, v] = toPassFrame(grid.angle, [touchOff.x, touchOff.y]);
  return [{ x: u - grid.origin[0], y: v - grid.origin[1], radius: touchOff.diameter / 2, top: 0 }];
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
 * `profile` reaching `by` further out, flat over its first `by`: dropped at
 * two points `by` apart, it keeps the straight move between them clear of
 * everything the true profile would touch along the way.
 */
export function widened(profile: CutterProfile, by: number): CutterProfile {
  return {
    radius: profile.radius + by,
    flat: profile.flat,
    height: (distance) => profile.height(Math.max(0, distance - by)),
    reach: (depth) => profile.reach(depth) + by,
  };
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

/** Most points the tool is dropped at between two samples it rises or drops steeply between. */
const MAX_SUBSAMPLES = 16;

/**
 * The moves along heights sampled `spacing` apart on a straight line, as
 * `[sample, height]` pairs from the first sample, `sample` fractional
 * between samples: merged with `simplifyHeights`, except where the tool
 * rises or drops more than `spacing` between two samples (#151). The model
 * may rise above a straight move there, such as a wall a flat end mill drops
 * off anywhere between the samples, whose top edge the move would nick.
 *
 * With `between` (the tool's height at a fraction of the way from one sample
 * to the next), the tool is dropped at points between such samples, about
 * as many as the samples are steep, and follows them. Wherever the tool
 * still rises or drops more than their spacing between two of them, or
 * without `between`, it goes over at the higher of the two instead: along
 * at that height, then straight down or up.
 */
export function sampleMoves(
  heights: ArrayLike<number>,
  spacing: number,
  between: ((sample: number, fraction: number) => number) | null = null,
  tolerance = RELIEF_TOLERANCE,
): [number, number][] {
  const moves: [number, number][] = [];
  const push = (sample: number, height: number) => {
    const last = moves.at(-1);
    if (!last || last[0] !== sample || last[1] !== height) moves.push([sample, height]);
  };
  /** Over at the higher of two points `a` and `b`. */
  const over = (a: number, za: number, b: number, zb: number) => {
    const high = Math.max(za, zb);
    push(a, high);
    push(b, high);
    push(b, zb);
  };
  const count = heights.length;
  let from = 0;
  for (let k = 0; k < count; k++) {
    const za = heights[k] as number;
    const zb = heights[k + 1] as number;
    const steep = k + 1 < count && Math.abs(zb - za) > spacing;
    if (k + 1 < count && !steep) continue;
    const run = Array.from({ length: k - from + 1 }, (_, i) => heights[from + i] as number);
    for (const i of simplifyHeights(run, tolerance)) push(from + i, run[i] as number);
    if (steep) {
      const parts = between ? Math.min(MAX_SUBSAMPLES, Math.ceil(Math.abs(zb - za) / spacing)) : 1;
      let previous = za;
      for (let j = 1; j <= parts; j++) {
        const z = j === parts ? zb : (between as (s: number, f: number) => number)(k, j / parts);
        const [a, b] = [k + (j - 1) / parts, k + j / parts];
        if (Math.abs(z - previous) > spacing / parts) over(a, previous, b, z);
        else push(b, z);
        previous = z;
      }
    }
    from = k + 1;
  }
  return moves;
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

/** Values kept between toolpaths, by key. */
export type Cache<T> = {
  get(key: string): T | undefined;
  set(key: string, value: T): void;
};

/** Model heightmaps kept between toolpaths, by `reliefCacheKey`. */
export type ReliefCache = Cache<Float32Array>;

/** A `ReliefCache` holding the last `capacity` heightmaps used. */
export function createReliefCache(capacity = 2): ReliefCache {
  return createCache(capacity);
}

/** A `Cache` holding the last `capacity` values used. */
export function createCache<T>(capacity: number): Cache<T> {
  const entries = new Map<string, T>();
  return {
    get(key) {
      const value = entries.get(key);
      if (value !== undefined) {
        entries.delete(key);
        entries.set(key, value);
      }
      return value;
    },
    set(key, value) {
      entries.delete(key);
      entries.set(key, value);
      for (const oldest of entries.keys()) {
        if (entries.size <= capacity) break;
        entries.delete(oldest);
      }
    },
  };
}

/** Everything a model heightmap depends on: the mesh, where it is, the grid and the offset. */
export function reliefCacheKey(
  { sha256, transform }: Pick<ModelView, "sha256" | "transform">,
  { columns, rows, cellWidth, cellHeight, angle, origin }: ReliefGrid,
  offset: number,
): string {
  return JSON.stringify([
    sha256,
    transform,
    angle,
    origin,
    columns,
    rows,
    cellWidth,
    cellHeight,
    offset,
  ]);
}

/** The model heightmap offset by `offset`, from `cache` or computed (and cached), reporting progress. */
export function* modelHeightsSteps(
  model: ModelView,
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

/**
 * How far above a rest operation's own cut the stock left by the earlier
 * operations must be for it to cut there (#118): less is noise, such as the
 * `RELIEF_TOLERANCE` a pass of the same tool leaves, or `float32` rounding.
 */
export const REST_MATERIAL = 0.05;

/**
 * How wide material left by the earlier operations must be for a rest
 * operation to cut it (#118): roughing leaves slivers a cell or two wide on
 * walls, which aren't worth chasing along every wall.
 */
export const REST_MIN_WIDTH = 0.5;

/**
 * The profile a rest operation drops onto the stock left to find material:
 * the tool's own, cut short by half of `REST_MIN_WIDTH` (or half its
 * radius), so slivers at the edge of its reach don't count.
 */
export function restProfile(profile: CutterProfile): CutterProfile {
  const radius = profile.radius - Math.min(REST_MIN_WIDTH / 2, profile.radius / 2);
  return { ...profile, radius, reach: (depth) => Math.min(radius, profile.reach(depth)) };
}

/**
 * How closely, in cells, the rest stock's sweep finds a sloped move's lowest
 * point: far quicker than exactly, and it only ever leaves more stock.
 */
const REST_SWEEP_TOLERANCE = 1 / 8;

/** Moves swept between two progress reports. */
const MOVES_PER_STEP = 4096;

/**
 * The grid the stock left before a rest operation is simulated on: over the
 * same area as the operation's `grid`, grown to hold `cover` (in stock
 * coordinates) too if given, in the same frame, with cells no smaller than
 * half of `REST_MIN_WIDTH`, larger (`coarsened`) if it would take more than
 * `maxCells`. Narrower material doesn't count, and sweeping a finishing
 * toolpath's many short moves on the operation's own cells would take
 * minutes.
 */
export function restGrid(
  grid: ReliefGrid,
  cover: Rect | null = null,
  maxCells = MAX_RELIEF_CELLS,
): ReliefGrid {
  const [u0, v0] = grid.origin;
  const own: [number, number][] = [
    [u0, v0],
    [u0 + grid.columns * grid.cellWidth, v0 + grid.rows * grid.cellHeight],
  ];
  const corners = cover ? rectCorners(cover).map((corner) => toPassFrame(grid.angle, corner)) : [];
  const box = boxAround([...own, ...corners]);
  const width = box.max[0] - box.min[0];
  const length = box.max[1] - box.min[1];
  const size = Math.max(grid.cellWidth, grid.cellHeight, REST_MIN_WIDTH / 2);
  const { columns, rows, coarsened } = gridCells(width, length, size, maxCells);
  const [du, dv] = [u0 - box.min[0], v0 - box.min[1]];
  return {
    ...grid,
    columns,
    rows,
    cellWidth: width / columns,
    cellHeight: length / rows,
    origin: [box.min[0], box.min[1]],
    outline: grid.outline.map(([u, v]) => [u + du, v + dv]),
    coarsened,
  };
}

/**
 * The stock left by `cuts` over each cell of `grid` (PRD-0005 S8, ADR-0030):
 * the heightmap simulation (ADR-0019), its moves turned into the grid's frame. Cells inside `stock` start at its top,
 * those outside at `bottom` (no material); nothing goes below `bottom`.
 * Yields the fraction done every few thousand moves.
 */
export function* restHeightsSteps(
  grid: ReliefGrid,
  cuts: readonly SimulationCut[],
  stock: Rect | null,
  bottom: number,
): Generator<number, Float32Array> {
  const { columns, rows, cellWidth, cellHeight } = grid;
  const heights = new Float32Array(columns * rows);
  const tolerance = Math.min(cellWidth, cellHeight) * REST_SWEEP_TOLERANCE;
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const [x, y] = toStock(grid, (column + 0.5) * cellWidth, (row + 0.5) * cellHeight);
      const inside =
        !stock ||
        (x >= stock.min[0] && x <= stock.max[0] && y >= stock.min[1] && y <= stock.max[1]);
      heights[row * columns + column] = inside ? 0 : bottom;
    }
  }
  let total = 0;
  for (const { segments } of cuts) total += Math.floor(segments.length / 6);
  let done = 0;
  for (const { tool, segments } of cuts) {
    const moved = new Float32Array(segments.length);
    for (let i = 0; i + 2 < segments.length; i += 3) {
      const [u, v] = toPassFrame(grid.angle, [segments[i] as number, segments[i + 1] as number]);
      moved[i] = u - grid.origin[0];
      moved[i + 1] = v - grid.origin[1];
      moved[i + 2] = segments[i + 2] as number;
    }
    const profile = cutterProfile(tool);
    const count = Math.floor(moved.length / 6);
    for (let first = 0; first < count; first += MOVES_PER_STEP) {
      sweepMoves(grid, heights, profile, moved, first, first + MOVES_PER_STEP, tolerance);
      done += Math.min(MOVES_PER_STEP, count - first);
      yield done / total;
    }
  }
  for (let i = 0; i < heights.length; i++) {
    if ((heights[i] as number) < bottom) heights[i] = bottom;
  }
  return heights;
}

/**
 * The runs of samples `0` to `count - 1` a rest operation cuts: those where
 * `remaining` says material is left, each grown by a sample on both sides
 * (the moves to and from them may touch it), and joined across gaps of at
 * most `gap` samples, which aren't worth leaving the cut for.
 */
export function remainingRuns(
  remaining: (i: number) => boolean,
  count: number,
  gap: number,
): [number, number][] {
  const runs: [number, number][] = [];
  for (let i = 0; i < count; i++) {
    if (!remaining(i)) continue;
    const start = Math.max(0, i - 1);
    let end = i;
    while (end + 1 < count && remaining(end + 1)) end++;
    const run: [number, number] = [start, Math.min(count - 1, end + 1)];
    const last = runs.at(-1);
    if (last && run[0] - last[1] <= gap) last[1] = run[1];
    else runs.push(run);
    i = end;
  }
  return runs;
}

/**
 * The height a rest operation rapids across the samples `from` to `to` of a
 * pass at: the entry clearance above the highest of `stock` (the stock left
 * under the tool along the way, `RestDropper.highestUnder`) and the pass
 * itself, at most `safeZ`, never below either end of the pass.
 */
export function liftHeight(
  stock: number,
  passAt: (i: number) => number,
  from: number,
  to: number,
  clearance: number,
  safeZ: number,
): number {
  let highest = stock;
  for (let i = Math.min(from, to); i <= Math.max(from, to); i++) {
    highest = Math.max(highest, passAt(i));
  }
  return Math.max(Math.min(safeZ, highest + clearance), passAt(from), passAt(to));
}

/** The rest stock of an operation: the toolpaths cut before it, and the stock they cut. */
export type RestOptions = {
  /** The moves of the earlier enabled operations. */
  cuts: readonly SimulationCut[];
  /** The stock seen from above; outside it there is no material. */
  stock: Rect | null;
};

/** The stock left before a rest operation, on its `restGrid`. */
export type RestStock = { grid: ReliefGrid; heights: Float32Array };

/**
 * The stock left by `rest` on the `restGrid` of `grid`, grown to hold
 * `cover` if given, with the progress scaled into `[from, to]`.
 */
export function* restStockSteps(
  grid: ReliefGrid,
  rest: RestOptions,
  bottom: number,
  from: number,
  to: number,
  cover: Rect | null = null,
): Generator<number, RestStock> {
  const coarse = restGrid(grid, cover);
  const steps = restHeightsSteps(coarse, rest.cuts, rest.stock, bottom);
  for (let step = steps.next(); ; step = steps.next()) {
    if (step.done) return { grid: coarse, heights: step.value };
    yield from + (to - from) * step.value;
  }
}

/**
 * Drops a rest operation's tool (its `restProfile`) onto the stock left, at
 * the samples of the operation's own grid, to find where to cut. The rest
 * grid is coarser, but each sample drops the tool at its own position: the
 * stock an earlier pass of the same tool left there is never above it,
 * whatever the cells. Rapids go by `highestUnder` instead, the whole tool.
 * Positions are in the operation's grid, which the rest grid may extend.
 */
export class RestDropper {
  private readonly dropper: ToolDropper;
  /** How far from the tool's axis a cell may hold stock it meets: its radius and a cell's diagonal. */
  private readonly reach: number;
  /** The operation's grid origin in the rest grid. */
  private readonly du: number;
  private readonly dv: number;
  /** The rest tool's radius. */
  private readonly radius: number;
  /** For each rest column, the highest cell along a pass a tool there may meet (`dropLine`). */
  private readonly rowMaxima: Float32Array;
  private readonly bound: Float64Array;
  private readonly deque: Int32Array;

  constructor(
    private readonly stock: RestStock,
    private readonly grid: ReliefGrid,
    profile: CutterProfile,
  ) {
    const rest = restProfile(profile);
    this.dropper = new ToolDropper(stock.heights, stock.grid, rest);
    this.reach = profile.radius + Math.hypot(stock.grid.cellWidth, stock.grid.cellHeight);
    this.du = grid.origin[0] - stock.grid.origin[0];
    this.dv = grid.origin[1] - stock.grid.origin[1];
    this.radius = rest.radius;
    const { columns } = stock.grid;
    this.rowMaxima = new Float32Array(columns);
    this.bound = new Float64Array(columns);
    this.deque = new Int32Array(columns);
  }

  /**
   * The highest stock left that the whole tool may meet on the way from
   * `u0` to `u1` along the line `v` (in grid coordinates), whatever its
   * shape and whatever lies between the cells: the highest cell within its
   * radius and a cell's diagonal. Past the grid, the stock's top.
   */
  highestUnder(u0: number, u1: number, along: number): number {
    const { columns, rows, cellWidth, cellHeight } = this.stock.grid;
    const { heights } = this.stock;
    const reach = this.reach;
    const low = Math.min(u0, u1) + this.du - reach;
    const high = Math.max(u0, u1) + this.du + reach;
    const v = along + this.dv;
    let highest =
      low < 0 || high > columns * cellWidth || v - reach < 0 || v + reach > rows * cellHeight
        ? 0
        : -Infinity;
    const firstRow = Math.max(0, Math.floor((v - reach) / cellHeight));
    const lastRow = Math.min(rows - 1, Math.floor((v + reach) / cellHeight));
    const firstColumn = Math.max(0, Math.floor(low / cellWidth));
    const lastColumn = Math.min(columns - 1, Math.floor(high / cellWidth));
    for (let row = firstRow; row <= lastRow; row++) {
      for (let column = firstColumn; column <= lastColumn; column++) {
        highest = Math.max(highest, heights[row * columns + column] as number);
      }
    }
    return highest;
  }

  /**
   * Whether the tool at `[x, y]` (in grid coordinates), its tip at `z`, meets
   * more than `REST_MATERIAL` of the stock left.
   */
  remaining(x: number, y: number, z: number): boolean {
    const tip = this.dropper.dropPoint(x + this.du, y + this.dv, z + REST_MATERIAL);
    return tip > z + REST_MATERIAL;
  }

  /**
   * Raises `out[i]` to the tip height on the stock at the centre of column
   * `first + i` of the operation's grid, on the line `y`, for columns
   * `first` to `last`.
   */
  dropLine(y: number, first: number, last: number, out: Float64Array) {
    const { cellWidth } = this.grid;
    const { columns, cellWidth: restWidth } = this.stock.grid;
    const v = y + this.dv;
    // A drop never ends above the highest cell under the tool: where that is
    // no higher than the tip already is, the disc scan is skipped. Most of a
    // pass runs over stock cleared long before.
    this.passBounds(v);
    for (let i = first; i <= last; i++) {
      const u = (i + 0.5) * cellWidth + this.du;
      const tip = out[i - first] as number;
      const column = Math.min(columns - 1, Math.max(0, Math.floor(u / restWidth)));
      if ((this.bound[column] as number) <= tip) continue;
      out[i - first] = this.dropper.dropPoint(u, v, tip);
    }
  }

  /**
   * Fills `bound[c]` with the highest cell a tool centred in column `c` on
   * the line `v` may cover: the rows within its radius, the columns within
   * its radius and a cell. A centre past the grid's ends covers no more than
   * one in its last column does.
   */
  private passBounds(v: number) {
    const { columns, rows, cellWidth, cellHeight } = this.stock.grid;
    const { heights } = this.stock;
    const radius = this.radius;
    const firstRow = Math.max(0, Math.ceil((v - radius) / cellHeight - 0.5));
    const lastRow = Math.min(rows - 1, Math.floor((v + radius) / cellHeight - 0.5));
    this.rowMaxima.fill(-Infinity);
    for (let row = firstRow; row <= lastRow; row++) {
      const start = row * columns;
      for (let column = 0; column < columns; column++) {
        const cell = heights[start + column] as number;
        if (cell > (this.rowMaxima[column] as number)) this.rowMaxima[column] = cell;
      }
    }
    const reach = Math.ceil(radius / cellWidth) + 1;
    slidingMaximum(this.rowMaxima, 0, columns, 0, columns - 1, reach, this.bound, this.deque);
  }
}

export type ReliefFinishOptions = {
  /** Retract height above the stock top. */
  safeZ: number;
  /** Height above the stock top where rapids down stop and feeding starts, capped at `safeZ`. */
  entryClearance: number;
  /** The stock seen from above, for the `stock` and `margin` boundaries (`finishingBoundary`). */
  stock?: Rect | null;
  /** The stock's bottom, below which nothing is cut; `null` for no limit. */
  stockBottom?: number | null;
  /** A two-sided project's parting plane, below which this side cuts nothing around the model (ADR-0063); `null` for none. */
  parting?: number | null;
  /** On the bottom side, the flip to its stock coordinates; `null` on the top. */
  flip?: Flip | null;
  /** Model heightmaps kept between toolpaths. */
  cache?: ReliefCache;
  /** For rest machining (#118), what the earlier operations cut; `null` to cut everything. */
  rest?: RestOptions | null;
  /** The touch-off pad, which no pass cuts (#147); `null` for none. */
  touchOff?: TouchOffDisc | null;
  /** In a two-sided project, the holding tabs to leave (#357). */
  tabs?: readonly HoldingTab[];
};

/** Share of the progress the model heightmap takes; the passes take the rest. */
export const FINISH_SETUP_SHARE = 0.4;

/** Of `FINISH_SETUP_SHARE`, what the rest stock takes, for rest operations. */
const REST_SHARE = 0.25;

/** Said when a model has nothing to machine. */
export const NO_AREA_WARNING: ToolpathMessage = { code: "toolpath.noArea" };

/**
 * What every 3D finishing strategy starts from (ADR-0030): the model offset
 * by the stock to leave on a grid laid out along `angle`, the tool to drop
 * onto it, the lowest it may go, and for rest machining the stock left.
 */
export type FinishSetup = {
  grid: ReliefGrid;
  /** What the tool's centre covers (`roughingArea`), its four corners in the grid's coordinates, inside it or past it. */
  area: [number, number][];
  heights: Float32Array;
  profile: CutterProfile;
  /** The touch-off pad, as a disc in the grid's coordinates, or none. */
  discs: FlatDisc[];
  dropper: ToolDropper;
  /** The model's bottom plus the stock to leave, or the stock's bottom if higher. */
  floor: number;
  /** The lowest the tip goes with its centre over no part of the model (`ToolDropper`). */
  outside: number;
  restDropper: RestDropper | null;
  warnings: ToolpathMessage[];
};

/**
 * What a 3D finishing operation covers (ADR-0064): its boundary, but the
 * model's outline for waterline, whose contours follow the model's walls.
 */
export function finishingBoundary({ strategy, boundary }: ReliefFinishParams): RoughingBoundary {
  return strategy.type === "waterline" ? { type: "model" } : boundary;
}

/**
 * The `FinishSetup` of a 3D finishing operation, its grid along `angle`,
 * yielding the fraction done up to `FINISH_SETUP_SHARE`. A warning instead
 * for a model with no area seen from above, or a margin off the stock.
 *
 * The grid covers the model's outline; past the model's outline it has
 * roughing's margin, wide enough that a tool centred past it reaches no part
 * of the model, so passes covering the `finishingBoundary` beyond it only
 * meet the floor and the discs there.
 */
export function* finishSetupSteps(
  operation: ReliefFinishOperation,
  model: Model,
  positions: Float32Array,
  angle: number,
  {
    stock = null,
    stockBottom = null,
    parting = null,
    flip = null,
    cache,
    rest = null,
    touchOff = null,
    tabs = [],
  }: ReliefFinishOptions,
): Generator<number, { setup: FinishSetup } | { warning: ToolpathMessage }> {
  const { tool, params } = operation;
  const warnings: ToolpathMessage[] = [];
  const wanted = reliefCellSize(tool);
  const radius = tool.diameter / 2;
  const boundary = finishingBoundary(params);
  const margin = boundary.type === "model" ? 0 : params.stockToLeave + radius + wanted;
  const view = modelView(model, flip, parting);
  const grid = reliefGrid(view, angle, wanted, MAX_RELIEF_CELLS, margin);
  if (!grid) return { warning: NO_AREA_WARNING };
  const covered = roughingArea(boundary, view, stock, radius);
  if (!covered) return { warning: { code: "toolpath.marginOffStock" } };
  const area = rectCorners(covered).map((corner): [number, number] => {
    const [u, v] = toPassFrame(angle, corner);
    return [u - grid.origin[0], v - grid.origin[1]];
  });
  if (grid.coarsened) warnings.push(coarsenedWarning(grid, wanted));

  const modelShare = rest ? FINISH_SETUP_SHARE - REST_SHARE : FINISH_SETUP_SHARE;
  const heightsSteps = modelHeightsSteps(view, positions, grid, params.stockToLeave, cache);
  let heights: Float32Array;
  for (let step = heightsSteps.next(); ; step = heightsSteps.next()) {
    if (step.done) {
      heights = step.value;
      break;
    }
    yield modelShare * step.value;
  }

  const profile = cutterProfile(tool);
  const floor = reliefFloor(grid.base + params.stockToLeave, stockBottom, warnings);
  const outside = Math.max(floor, grid.outside + params.stockToLeave);
  // Past the grid, the stock left is simulated as far as the tool reaches from the area.
  const restStock = rest
    ? yield* restStockSteps(
        grid,
        rest,
        stockBottom ?? grid.base,
        modelShare,
        FINISH_SETUP_SHARE,
        margin > 0
          ? restCover(covered, rest.stock, radius + wanted + 2 * restCellSize(grid))
          : null,
      )
    : null;
  if (restStock?.grid.coarsened) warnings.push(restCoarsenedWarning(restStock.grid));
  const restDropper = restStock ? new RestDropper(restStock, grid, profile) : null;
  const discs = [...padDiscs(touchOff, grid), ...tabDiscs(reachModel(tabs, grid, heights), grid)];
  return {
    setup: {
      grid,
      area,
      heights,
      profile,
      discs,
      dropper: new ToolDropper(heights, grid, profile, discs, outside),
      floor,
      outside,
      restDropper,
      warnings,
    },
  };
}

/**
 * The rectangle the tool's centre covers when roughing or finishing within
 * `boundary` (ADR-0033, ADR-0038, ADR-0064), in stock coordinates:
 *
 * - `model`: the model's outline, so the tool cuts a radius past it.
 * - `stock`: the whole stock, the tool overhanging its edges by its radius.
 * - `margin`: the model's outline grown by the distance, or by the radius if
 *   that is more, so finishing never meets uncut material at the model's
 *   edge. The tool stays inside it, except where it reaches the stock's
 *   edge: there the centre goes to the edge, as for the whole stock.
 *
 * Without `stock`, the whole stock is the model's outline and a margin isn't
 * clipped. `null` when the margin leaves the tool no room inside the stock:
 * the model is off the stock, or only a sliver narrower than the tool of the
 * margin is on it.
 */
export function roughingArea(
  boundary: RoughingBoundary,
  model: Pick<ModelView, "box">,
  stock: Rect | null,
  radius: number,
): Rect | null {
  const rect = boxRect(model.box);
  if (boundary.type === "model") return rect;
  if (boundary.type === "stock") return stock ?? rect;
  const grow = Math.max(boundary.distance, radius);
  const side = (edge: number, direction: 1 | -1, stockEdge: number | undefined) => {
    const cut = edge + direction * grow;
    if (stockEdge !== undefined && direction * (cut - stockEdge) >= 0) return stockEdge;
    return cut - direction * radius;
  };
  const min: Point = [side(rect.min[0], -1, stock?.min[0]), side(rect.min[1], -1, stock?.min[1])];
  const max: Point = [side(rect.max[0], 1, stock?.max[0]), side(rect.max[1], 1, stock?.max[1])];
  return min[0] <= max[0] && min[1] <= max[1] ? { min, max } : null;
}

/**
 * Where a rest operation's stock left is simulated, besides the model's grid:
 * the `area` grown by `margin`, wherever the tool may reach from it (its
 * radius, the rest dropper's reach of a cell's diagonal and more), on the
 * stock, where earlier operations can have cut. Without a stock, nothing
 * past the model's grid: the stock is the model's outline (`roughingArea`).
 */
export function restCover(area: Rect, stock: Rect | null, margin: number): Rect | null {
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
export function restCellSize(grid: ReliefGrid): number {
  return Math.max(grid.cellWidth, grid.cellHeight, REST_MIN_WIDTH / 2);
}

/** Says that the stock left is simulated on larger cells than `REST_MIN_WIDTH` needs. */
export function restCoarsenedWarning(grid: ReliefGrid): ToolpathMessage {
  const size = Math.max(grid.cellWidth, grid.cellHeight);
  return {
    code: "toolpath.restCoarsened",
    values: { size: round3(size), width: round3(2 * size) },
  };
}

/**
 * Parallel finishing passes (PRD-0005 S4, ADR-0030, ADR-0032) over `setup`,
 * whose grid is laid out along the strategy's angle, in stock coordinates,
 * yielding the fraction done from `FINISH_SETUP_SHARE` on.
 *
 * Passes at the strategy's angle and the operation's step-over cover the
 * setup's area with the tool's centre, from edge to edge. Along each pass
 * the tool is dropped onto the model, offset by the stock to leave, at every
 * cell, and the points are merged into straight moves within
 * `RELIEF_TOLERANCE`. One-way passes all cut in the same direction,
 * retracting between them; zig-zag passes alternate, linked by a move that
 * follows the model. Each pass starts with a rapid down to the entry
 * clearance above the stock top and a plunge at the tool's plunge rate,
 * which is safe whether or not the model was roughed out; the passes
 * themselves cut at its feed rate.
 *
 * With rest machining (S8), the tool is also dropped onto the stock the
 * earlier operations left, and a pass only cuts where that is more than
 * `REST_MATERIAL` above it, and more than half of `REST_MIN_WIDTH` inside
 * the tool's reach. Across the gaps the tool rapids at the entry
 * clearance above what is left; it enters at that clearance too, and
 * links zig-zag passes only when they are close.
 */
export function* parallelPassesSteps(
  operation: ReliefFinishOperation,
  { grid, area, dropper, floor, restDropper, warnings }: FinishSetup,
  strategy: Extract<FinishingStrategy, { type: "parallel" }>,
  { safeZ, entryClearance }: Pick<ReliefFinishOptions, "safeZ" | "entryClearance">,
): Generator<number, Toolpath> {
  const { tool, params } = operation;
  const { cellWidth, cellHeight } = grid;
  // Passes run along row centres, where the heights are exact: from the
  // first row whose centre is in the area to the last, inside the grid or
  // past it, evenly spread, no more rows apart than fit in the step-over, so
  // rounding never spreads them further.
  const vs = area.map(([, v]) => v);
  const us = area.map(([u]) => u);
  const firstRow = Math.ceil(Math.min(...vs) / cellHeight - 0.5);
  const finalRow = Math.floor(Math.max(...vs) / cellHeight - 0.5);
  const spacing = (tool.diameter * params.stepOver) / 100;
  const rowsApart = Math.max(1, Math.floor(spacing / cellHeight + 1e-9));
  const count = Math.ceil((finalRow - firstRow) / rowsApart) + 1;
  let lastRow: number | null = null;
  const samplesAtMost = Math.ceil((Math.max(...us) - Math.min(...us)) / cellWidth) + 1;
  const tips = new Float64Array(samplesAtMost);
  const stockTips = new Float64Array(samplesAtMost);
  // Gaps narrower than the tool aren't worth leaving the cut for.
  const gap = Math.ceil(tool.diameter / cellWidth);
  const maxLink = 2 * tool.diameter;
  const builder = new ToolpathBuilder(safeZ, entryClearance);
  const zigzag = strategy.direction === "zigzag";
  let previous: { u: number; v: number; z: number } | null = null;
  let reversed = false;

  const at = (u: number, v: number, z: number): Vec3 => [...toStock(grid, u, v), z];
  /** Down to `z` from `entry`, the stock top's entry clearance unless lower. */
  function enter([x, y, z]: Vec3, entry = builder.clearance) {
    builder.rapid([x, y, Math.max(entry, z)]);
    builder.feed([x, y, z], tool.plungeRate);
  }

  for (let line = 0; line < count; line++) {
    const row =
      firstRow + (count > 1 ? Math.round((line * (finalRow - firstRow)) / (count - 1)) : 0);
    if (row === lastRow) continue;
    lastRow = row;
    const v = (row + 0.5) * cellHeight;
    const span = outlineSpan(area, v);
    const first = span ? Math.ceil(span[0] / cellWidth - 0.5) : 1;
    const last = span ? Math.floor(span[1] / cellWidth - 0.5) : 0;
    if (first <= last) {
      const samples = last - first + 1;
      const pass = tips.subarray(0, samples);
      pass.fill(floor);
      dropper.dropLine(v, first, last, pass);
      const left = stockTips.subarray(0, samples);
      let runs: [number, number][] = [[0, samples - 1]];
      if (restDropper) {
        // Only stock more than `REST_MATERIAL` above the pass counts, so the
        // tool dropped onto it starts there, which spares scanning most cells.
        for (let i = 0; i < samples; i++) left[i] = (pass[i] as number) + REST_MATERIAL;
        restDropper.dropLine(v, first, last, left);
        runs = remainingRuns(
          (i) => (left[i] as number) > (pass[i] as number) + REST_MATERIAL,
          samples,
          gap,
        );
      }
      if (reversed) {
        pass.reverse();
        left.reverse();
        runs = runs.map(([a, b]): [number, number] => [samples - 1 - b, samples - 1 - a]).reverse();
      }
      const u = (i: number) => ((reversed ? last - i : first + i) + 0.5) * cellWidth;
      /** The entry clearance above what the earlier operations left under the tool at sample `i`. */
      const entryAt = (i: number) =>
        restDropper
          ? Math.min(builder.clearance, restDropper.highestUnder(u(i), u(i), v) + builder.clearance)
          : builder.clearance;
      for (const [index, [a, b]] of runs.entries()) {
        const startU = u(a);
        const start = at(startU, v, pass[a] as number);
        if (index > 0) {
          // Across the gap, clear of what is left there.
          const before = runs[index - 1]?.[1] as number;
          const lift = liftHeight(
            (restDropper as RestDropper).highestUnder(u(before), u(a), v),
            (i) => pass[i] as number,
            before,
            a,
            builder.clearance,
            safeZ,
          );
          const [x, y] = toStock(grid, u(before), v);
          builder.rapid([x, y, lift]);
          builder.rapid([start[0], start[1], lift]);
          enter(start, entryAt(a));
        } else if (
          previous &&
          zigzag &&
          (!restDropper || Math.hypot(startU - previous.u, v - previous.v) <= maxLink)
        ) {
          // A link that follows the model to the next pass.
          const from = previous;
          const du = startU - from.u;
          const dv = v - from.v;
          const steps = Math.max(
            1,
            Math.ceil(Math.hypot(du, dv) / Math.min(cellWidth, cellHeight)),
          );
          const linkAt = (k: number) =>
            [from.u + (du * k) / steps, from.v + (dv * k) / steps] as const;
          const link = new Float64Array(steps + 1);
          link[0] = from.z;
          for (let k = 1; k < steps; k++) link[k] = dropper.dropPoint(...linkAt(k), floor);
          link[steps] = pass[a] as number;
          const linkBetween = (k: number, f: number) => dropper.dropPoint(...linkAt(k + f), floor);
          for (const [k, z] of sampleMoves(link, Math.hypot(du, dv) / steps, linkBetween)) {
            // The first may climb straight up from where the tool is; the
            // builder drops a move that goes nowhere.
            builder.feed(at(...linkAt(k), z), tool.feedRate);
          }
        } else {
          builder.travel(start[0], start[1]);
          enter(start, entryAt(a));
        }
        const passBetween = (i: number, f: number) => dropper.dropPoint(u(a + i + f), v, floor);
        for (const [i, z] of sampleMoves(pass.subarray(a, b + 1), cellWidth, passBetween)) {
          builder.feed(at(u(a + i), v, z), tool.feedRate);
        }
        previous = { u: u(b), v, z: pass[b] as number };
      }
      if (zigzag) reversed = !reversed;
    }
    yield FINISH_SETUP_SHARE + ((1 - FINISH_SETUP_SHARE) * (line + 1)) / count;
  }
  builder.retract();
  return { moves: builder.moves, warnings };
}

/**
 * The lowest a 3D operation cuts: the model's bottom plus the stock to leave,
 * `lowest`, but no lower than the stock's bottom, saying so in `warnings`
 * (ADR-0034): a model deeper than the stock is cut off there. In a
 * two-sided project, cells outside the model hold the tool at the parting
 * plane instead (`ModelView.outside`, ADR-0063).
 */
export function reliefFloor(
  lowest: number,
  stockBottom: number | null,
  warnings: ToolpathMessage[],
): number {
  if (stockBottom !== null && lowest < stockBottom) {
    warnings.push({ code: "toolpath.belowStock" });
    return stockBottom;
  }
  return lowest;
}

/** Millimetres to three decimals, as warnings show sizes. */
export const round3 = (mm: number) => Math.round(mm * 1000) / 1000;

/** Says that `grid` has larger cells than the `wanted` size. */
export function coarsenedWarning(grid: ReliefGrid, wanted: number): ToolpathMessage {
  const size = Math.max(grid.cellWidth, grid.cellHeight);
  return { code: "toolpath.coarsened", values: { size: round3(size), wanted: round3(wanted) } };
}

/** Runs `steps` to the end, ignoring the progress it reports. */
export function runSteps<T>(steps: Generator<number, T>): T {
  for (;;) {
    const step = steps.next();
    if (step.done) return step.value;
  }
}
