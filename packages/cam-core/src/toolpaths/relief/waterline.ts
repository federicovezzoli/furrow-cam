import type { FinishingStrategy, ReliefFinishOperation } from "@furrow/document";
import type { HeightmapGrid } from "../../simulation/simulation";
import { depthLevels } from "../passes";
import { type Toolpath, ToolpathBuilder } from "../toolpath";
import {
  FINISH_SETUP_SHARE,
  type FinishSetup,
  type ReliefFinishOptions,
  remainingRuns,
  ToolDropper,
  toStock,
  widened,
} from "./finish";

/**
 * Waterline finishing (#130, PRD-0005 S10, ADR-0039): contours at constant
 * Z around the model, the tool's centre where it just touches the model
 * offset by the stock to leave.
 */

/** How far a tip may be above a level and still count as at it: `float32` heights round. */
export const AT_LEVEL = 1e-5;

/** Rows of tips dropped between two progress reports. */
const ROWS_PER_STEP = 32;

/** Of the progress after the setup, what the map of tip heights takes. */
const TIPS_SHARE = 0.5;

/**
 * How far past its radius the tool is checked when contour points and moves
 * are made safe, so they keep a real clearance rather than touching the
 * model exactly (and rounding into it in `float32` G-code coordinates).
 */
const CLEARANCE = 0.001;

/** How many times a move between contour points is halved, at most, to keep it clear of the model. */
const SAFETY_SPLITS = 6;

/** Halvings that bring a contour point that would cut into the model back towards safety. */
const SAFETY_HALVINGS = 12;

/**
 * The tool dropped onto the model at the centre of every cell of the setup's
 * grid, row by row: the lowest its tip may go there. Yields the progress
 * scaled into `[from, to]`.
 */
export function* tipHeightsSteps(
  { grid, dropper, floor }: Pick<FinishSetup, "grid" | "dropper" | "floor">,
  from = 0,
  to = 1,
): Generator<number, Float64Array> {
  const { columns, rows, cellHeight } = grid;
  const tips = new Float64Array(columns * rows);
  const line = new Float64Array(columns);
  for (let row = 0; row < rows; row++) {
    line.fill(floor);
    dropper.dropLine((row + 0.5) * cellHeight, 0, columns - 1, line);
    tips.set(line, row * columns);
    if ((row + 1) % ROWS_PER_STEP === 0) yield from + ((to - from) * (row + 1)) / rows;
  }
  return tips;
}

/**
 * The tool dropped onto the model as it is (`exact`) and widened by
 * `CLEARANCE` (`widened`): contour points are placed clear of the widened
 * one, so the moves between them, checked against the exact one, only sag
 * into the model where cells are coarse.
 */
export type SafetyTools = { exact: ToolDropper; widened: ToolDropper };

/** Squares of cell centres a block of `SquareBlocks` holds along each side. */
const BLOCK = 16;

/**
 * The lowest and highest of the values at the corners of each block of
 * squares between cell centres, `BLOCK` squares a side, row by row and
 * `across` blocks to a row: a contour only crosses blocks it is between.
 */
export type SquareBlocks = { across: number; low: Float64Array; high: Float64Array };

export function squareBlocks(
  values: ArrayLike<number>,
  { columns, rows }: HeightmapGrid,
): SquareBlocks {
  const across = Math.max(1, Math.ceil((columns - 1) / BLOCK));
  const down = Math.max(1, Math.ceil((rows - 1) / BLOCK));
  const low = new Float64Array(across * down).fill(Infinity);
  const high = new Float64Array(across * down).fill(-Infinity);
  // A cell on a block's edge is a corner of the squares on both sides of it.
  const update = (block: number, value: number) => {
    if (value < (low[block] as number)) low[block] = value;
    if (value > (high[block] as number)) high[block] = value;
  };
  for (let row = 0; row < rows; row++) {
    const above = Math.min(down - 1, Math.floor(row / BLOCK));
    const below = Math.max(0, Math.ceil(row / BLOCK) - 1);
    for (let column = 0; column < columns; column++) {
      const value = values[row * columns + column] as number;
      const right = Math.min(across - 1, Math.floor(column / BLOCK));
      const left = Math.max(0, Math.ceil(column / BLOCK) - 1);
      update(above * across + right, value);
      if (left !== right) update(above * across + left, value);
      if (below !== above) {
        update(below * across + right, value);
        if (left !== right) update(below * across + left, value);
      }
    }
  }
  return { across, low, high };
}

/** A contour in grid coordinates: closed, or open where it meets the grid's edge. */
export type IsoLine = { points: [number, number][]; closed: boolean };

/**
 * The contours where `values`, sampled at the centres of `grid`'s cells,
 * cross `level`, traced with marching squares between the centres: each
 * point is where the values, interpolated along a side of a square, reach
 * the level. Contours run with the values above the level on their right,
 * and leave the grid open at its edge. Where a square's opposite corners
 * are above, its centre (their mean) decides whether they join.
 *
 * With `tools`, each point is checked: where the tool there would reach
 * above `level`, it moves back along its side towards the cell below the
 * level until it doesn't, so the tool at `level` never cuts into the model
 * at a point.
 */
export function isoLines(
  values: ArrayLike<number>,
  grid: HeightmapGrid,
  level: number,
  tools: SafetyTools | null = null,
  blocks: SquareBlocks = squareBlocks(values, grid),
): IsoLine[] {
  const { columns, rows, cellWidth, cellHeight } = grid;
  const step = Math.min(cellWidth, cellHeight);
  const above = (cell: number) => (values[cell] as number) > level + AT_LEVEL;
  /** The cells at either end of the side `id` of a square: from a cell to the next one right (even) or up (odd). */
  const ends = (id: number) => {
    const p = id >> 1;
    return [p, id & 1 ? p + columns : p + 1] as const;
  };
  // Between cells less than half a cell apart in height, the tool's height
  // is near enough straight that the contour needs no check there.
  const steep = (id: number) => {
    const [p, q] = ends(id);
    return Math.abs((values[q] as number) - (values[p] as number)) >= step / 2;
  };
  /** Whether the tool at `[x, y]` stays at or below the level: widened by `CLEARANCE`, or exactly. */
  const clear = (x: number, y: number, exactly = false) =>
    !tools ||
    (exactly ? tools.exact : tools.widened).dropPoint(x, y, -Infinity) <= level + AT_LEVEL;
  /** Where the contour crosses the side `id` of a square. */
  const point = (id: number): [number, number] => {
    const [p, q] = ends(id);
    const vp = values[p] as number;
    const vq = values[q] as number;
    const t = Math.min(1, Math.max(0, (level + AT_LEVEL - vp) / (vq - vp)));
    const px = ((p % columns) + 0.5) * cellWidth;
    const py = (Math.floor(p / columns) + 0.5) * cellHeight;
    const qx = ((q % columns) + 0.5) * cellWidth;
    const qy = (Math.floor(q / columns) + 0.5) * cellHeight;
    const at = (s: number): [number, number] => [px + (qx - px) * s, py + (qy - py) * s];
    if (!tools || !steep(id)) return at(t);
    const safe = (s: number) => clear(...at(s));
    if (safe(t)) return at(t);
    // The cell below the level is safe: its tip is one of `values`.
    let low = vp <= level + AT_LEVEL ? 0 : 1;
    let high = t;
    for (let i = 0; i < SAFETY_HALVINGS; i++) {
      const middle = (low + high) / 2;
      if (safe(middle)) low = middle;
      else high = middle;
    }
    return at(low);
  };

  // Each square's sides, counter-clockwise from its bottom-left cell, and the
  // segments joining where the contour enters (from below the level to above)
  // to where it leaves.
  const next = new Map<number, number>();
  const sides = [0, 0, 0, 0];
  const corners = [0, 0, 0, 0];
  const isAbove = [false, false, false, false];
  const threshold = level + AT_LEVEL;
  for (let block = 0; block < blocks.low.length; block++) {
    if (
      !((blocks.low[block] as number) <= threshold && (blocks.high[block] as number) > threshold)
    ) {
      continue;
    }
    const firstRow = Math.floor(block / blocks.across) * BLOCK;
    const firstColumn = (block % blocks.across) * BLOCK;
    const lastRow = Math.min(rows - 1, firstRow + BLOCK);
    const lastColumn = Math.min(columns - 1, firstColumn + BLOCK);
    for (let row = firstRow; row < lastRow; row++) {
      for (let column = firstColumn; column < lastColumn; column++) {
        const a = row * columns + column;
        corners[0] = a;
        corners[1] = a + 1;
        corners[2] = a + columns + 1;
        corners[3] = a + columns;
        let count = 0;
        for (let k = 0; k < 4; k++) {
          isAbove[k] = above(corners[k] as number);
          if (isAbove[k]) count++;
        }
        if (count === 0 || count === 4) continue;
        sides[0] = 2 * a;
        sides[1] = 2 * (a + 1) + 1;
        sides[2] = 2 * (a + columns);
        sides[3] = 2 * a + 1;
        const crossings = count === 2 && isAbove[0] === isAbove[2] ? 4 : 2;
        const join =
          crossings === 4 &&
          corners.reduce((sum, cell) => sum + (values[cell] as number), 0) / 4 > level + AT_LEVEL;
        for (let k = 0; k < 4; k++) {
          if (isAbove[k] || !isAbove[(k + 1) % 4]) continue;
          // Entering at side k; leaving at the next side counter-clockwise
          // where the corners go from above to below, or the previous one
          // when a saddle's corners above join through its centre.
          let exit = -1;
          if (crossings === 2) {
            for (let j = 1; j < 4; j++) {
              const side = (k + j) % 4;
              if (isAbove[side] && !isAbove[(side + 1) % 4]) exit = side;
            }
          } else {
            exit = join ? (k + 3) % 4 : (k + 1) % 4;
          }
          next.set(sides[k] as number, sides[exit] as number);
        }
      }
    }
  }

  const lines: IsoLine[] = [];
  /**
   * Points to add between `a` and `b` on a steep side, in order, where the
   * straight move between them would sag into the model (around a sharp
   * corner, by up to a cell's length squared over four times the tool's
   * radius): each halving's middle, where it isn't clear, moved away from
   * the model (on the move's left) until it is, then both halves again, a
   * few times over.
   */
  const between = (a: [number, number], b: [number, number], depth = 0): [number, number][] => {
    const middle: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (depth >= SAFETY_SPLITS || !(length > 0) || clear(...middle, true)) return [];
    const left: [number, number] = [-(b[1] - a[1]) / length, (b[0] - a[0]) / length];
    const at = (s: number): [number, number] => [middle[0] + left[0] * s, middle[1] + left[1] * s];
    let low = 0;
    let high = step;
    if (!clear(...at(high))) return [];
    for (let i = 0; i < SAFETY_HALVINGS; i++) {
      const s = (low + high) / 2;
      if (clear(...at(s))) high = s;
      else low = s;
    }
    const moved = at(high);
    return [...between(a, moved, depth + 1), moved, ...between(moved, b, depth + 1)];
  };
  const walk = (start: number, closed: boolean) => {
    const ids = [start];
    let id = start;
    for (let to = next.get(id); to !== undefined; to = next.get(id)) {
      next.delete(id);
      id = to;
      if (closed && id === start) break;
      ids.push(id);
    }
    const located = ids.map(point);
    const points: [number, number][] = [];
    for (let i = 0; i < ids.length; i++) {
      const a = located[i] as [number, number];
      points.push(a);
      const j = i + 1 < ids.length ? i + 1 : closed ? 0 : -1;
      if (j < 0 || !tools || !(steep(ids[i] as number) || steep(ids[j] as number))) continue;
      points.push(...between(a, located[j] as [number, number]));
    }
    lines.push({ points: mergeStraight(points, closed), closed });
  };
  const entered = new Set(next.values());
  for (const start of [...next.keys()]) {
    if (!entered.has(start) && next.has(start)) walk(start, false);
  }
  for (const start of [...next.keys()]) {
    if (next.has(start)) walk(start, true);
  }
  return lines;
}

/** `points` without those on a straight line between their neighbours. */
export function mergeStraight(points: [number, number][], closed: boolean): [number, number][] {
  if (points.length < 3) return points;
  const kept: [number, number][] = [];
  const count = points.length;
  for (let i = 0; i < count; i++) {
    const isEnd = !closed && (i === 0 || i === count - 1);
    const [ax, ay] = points[(i + count - 1) % count] as [number, number];
    const [bx, by] = points[i] as [number, number];
    const [cx, cy] = points[(i + 1) % count] as [number, number];
    const cross = (bx - ax) * (cy - by) - (by - ay) * (cx - bx);
    const dot = (bx - ax) * (cx - bx) + (by - ay) * (cy - by);
    if (isEnd || Math.abs(cross) > 1e-12 || dot <= 0) kept.push(points[i] as [number, number]);
  }
  return kept.length >= 2 ? kept : points;
}

/** `points` with points added along each straight move, no more than `spacing` apart. */
function densify(points: [number, number][], spacing: number): [number, number][] {
  const dense: [number, number][] = points.slice(0, 1);
  for (let i = 1; i < points.length; i++) {
    const [ax, ay] = points[i - 1] as [number, number];
    const [bx, by] = points[i] as [number, number];
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / spacing));
    for (let k = 1; k <= steps; k++) {
      dense.push([ax + ((bx - ax) * k) / steps, ay + ((by - ay) * k) / steps]);
    }
  }
  return dense;
}

/**
 * Waterline finishing over `setup`, whose grid is along the stock's axes,
 * in stock coordinates, yielding the fraction done from
 * `FINISH_SETUP_SHARE` on.
 *
 * The tool is dropped at every cell into a map of tip heights. At levels
 * from the stock top down to the floor, in equal steps no deeper than the
 * strategy's step-down, the tool's centre follows the contours where that
 * map crosses the level (`isoLines`), the model on its right (climb milling
 * with a clockwise spindle). Contours are cut from the top down, each level
 * from the nearest contour to the next; a closed one starts at its point
 * nearest the tool. The tool feeds straight to the next contour when it is
 * no more than two tool diameters away and the move stays clear of the
 * model; otherwise it retracts, and enters with a rapid down to the entry
 * clearance and a plunge.
 *
 * With rest machining, a contour is only cut where the tool there meets
 * more than `REST_MATERIAL` of the stock left, retracting across the gaps.
 */
export function* waterlineSteps(
  operation: ReliefFinishOperation,
  { grid, heights, profile, discs, dropper, floor, outside, restDropper, warnings }: FinishSetup,
  strategy: Extract<FinishingStrategy, { type: "waterline" }>,
  { safeZ, entryClearance }: Pick<ReliefFinishOptions, "safeZ" | "entryClearance">,
): Generator<number, Toolpath> {
  const { tool } = operation;
  const share = 1 - FINISH_SETUP_SHARE;
  const tips = yield* tipHeightsSteps(
    { grid, dropper, floor },
    FINISH_SETUP_SHARE,
    FINISH_SETUP_SHARE + TIPS_SHARE * share,
  );
  const checker = new ToolDropper(heights, grid, widened(profile, CLEARANCE), discs, outside);
  const builder = new ToolpathBuilder(safeZ, entryClearance);
  const step = Math.min(grid.cellWidth, grid.cellHeight);
  const maxLink = 2 * tool.diameter;
  // Gaps narrower than the tool aren't worth leaving the cut for.
  const gap = Math.ceil(tool.diameter / step);
  let previous: [number, number, number] | null = null;

  const toStock3 = ([u, v, z]: [number, number, number]): [number, number, number] => [
    ...toStock(grid, u, v),
    z,
  ];
  /** Whether a straight feed from `a` to `b` stays clear of the model, in grid coordinates. */
  const clear = (a: [number, number, number], b: [number, number, number]) => {
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (length > maxLink) return false;
    const steps = Math.max(1, Math.ceil(length / step));
    for (let k = 1; k < steps; k++) {
      const s = k / steps;
      const z = a[2] + (b[2] - a[2]) * s;
      const tip = checker.dropPoint(a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s, floor);
      if (tip > z + AT_LEVEL) return false;
    }
    return true;
  };

  const levels = depthLevels(-floor, strategy.stepDown);
  const blocks = squareBlocks(tips, grid);
  for (const [index, z] of levels.entries()) {
    const lines = isoLines(tips, grid, z, { exact: dropper, widened: checker }, blocks);
    while (lines.length > 0) {
      // The nearest contour next; a closed one from its nearest point.
      const [u0, v0] = previous ?? [0, 0];
      let best = 0;
      let bestPoint = 0;
      let bestDistance = Infinity;
      for (const [i, line] of lines.entries()) {
        const candidates = line.closed ? line.points.length : 1;
        for (let k = 0; k < candidates; k++) {
          const [u, v] = line.points[k] as [number, number];
          const distance = Math.hypot(u - u0, v - v0);
          if (distance < bestDistance) {
            bestDistance = distance;
            best = i;
            bestPoint = k;
          }
        }
      }
      const [line] = lines.splice(best, 1) as [IsoLine];
      const points = line.closed
        ? [...line.points.slice(bestPoint), ...line.points.slice(0, bestPoint + 1)]
        : line.points;
      // For rest machining, every cell along the contour is checked, not
      // only the corners left after merging.
      const path = (restDropper ? densify(points, step) : points).map(
        ([u, v]): [number, number, number] => [u, v, z],
      );
      const runs: [number, number][] = restDropper
        ? remainingRuns(
            (i) => restDropper.remaining(...(path[i] as [number, number, number])),
            path.length,
            gap,
          )
        : [[0, path.length - 1]];
      for (const [a, b] of runs) {
        const start = path[a] as [number, number, number];
        if (previous && clear(previous, start)) {
          builder.feed(toStock3(start), tool.feedRate);
        } else {
          const [x, y] = toStock(grid, start[0], start[1]);
          builder.travel(x, y);
          builder.rapid([x, y, Math.max(builder.clearance, z)]);
          builder.feed([x, y, z], tool.plungeRate);
        }
        const run = path.slice(a, b + 1);
        const kept = restDropper
          ? mergeStraight(
              run.map(([u, v]): [number, number] => [u, v]),
              false,
            ).map(([u, v]): [number, number, number] => [u, v, z])
          : run;
        for (const point of kept.slice(1)) builder.feed(toStock3(point), tool.feedRate);
        previous = path[b] as [number, number, number];
      }
    }
    yield FINISH_SETUP_SHARE +
      share * (TIPS_SHARE + ((1 - TIPS_SHARE) * (index + 1)) / levels.length);
  }
  builder.retract();
  return { moves: builder.moves, warnings };
}
