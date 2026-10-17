import type { FinishingStrategy, ReliefFinishOperation } from "@furrow/document";
import type { HeightmapGrid } from "../../simulation/simulation";
import { type Toolpath, ToolpathBuilder } from "../toolpath";
import {
  FINISH_SETUP_SHARE,
  type FinishSetup,
  RELIEF_TOLERANCE,
  type ReliefFinishOptions,
  remainingRuns,
  simplifyHeights,
  ToolDropper,
  toStock,
} from "./finish";

/**
 * Spiral finishing (#130, PRD-0005 S10, ADR-0039): one continuous cut over
 * the model's outline, laps a step-over apart, the tool dropped onto the
 * model along it.
 */

/**
 * A straight run of a spiral along a row of cell centres (`along: "row"`,
 * `line` its row) or a column, from cell `from` to cell `to` of it, either
 * way.
 */
export type SpiralRun = { along: "row" | "column"; line: number; from: number; to: number };

/**
 * A rectangular spiral over the centres of a grid of `columns` × `rows`
 * cells, from the bottom-left cell inwards, counter-clockwise, as runs along
 * rows and columns. The first lap follows the outermost cells; each next one
 * is `across` columns and `down` rows further in, stepping in along its
 * first row. Once no lap fits, the last one is closed, and a run along its
 * middle row (or column) covers what is inside when that is wider than a
 * step. Runs follow each other end to start. Laps are a step apart, so no
 * point of the grid is more than half a step from a run, except in the
 * corners between two laps, where it may be up to `step / √2` away.
 */
export function spiralRuns(
  columns: number,
  rows: number,
  across: number,
  down: number,
): SpiralRun[] {
  const runs: SpiralRun[] = [];
  let [first, last, bottom, top] = [0, columns - 1, 0, rows - 1];
  let start = 0;
  for (;;) {
    runs.push({ along: "row", line: bottom, from: start, to: last });
    if (bottom === top) break;
    runs.push({ along: "column", line: last, from: bottom, to: top });
    if (first === last) break;
    runs.push({ along: "row", line: top, from: last, to: first });
    const next = [first + across, last - across, bottom + down, top - down] as const;
    if (next[0] <= next[1] && next[2] <= next[3]) {
      runs.push({ along: "column", line: first, from: top, to: next[2] });
      start = first;
      [first, last, bottom, top] = next;
      continue;
    }
    runs.push({ along: "column", line: first, from: top, to: bottom });
    if (top - bottom < 2 * down && top - bottom > down) {
      const middle = (bottom + top) >> 1;
      runs.push({ along: "column", line: first, from: bottom, to: middle });
      runs.push({ along: "row", line: middle, from: first, to: last });
    } else if (last - first < 2 * across && last - first > across) {
      const middle = (first + last) >> 1;
      runs.push({ along: "row", line: bottom, from: first, to: middle });
      runs.push({ along: "column", line: middle, from: bottom, to: top });
    }
    break;
  }
  return runs;
}

/** `runs` the other way: the spiral from its end to its start. */
function reversed(runs: SpiralRun[]): SpiralRun[] {
  return runs.map(({ along, line, from, to }) => ({ along, line, from: to, to: from })).reverse();
}

/** `heights` on a grid turned so its columns become rows, and that grid. */
function transposed(heights: Float32Array, grid: HeightmapGrid) {
  const { columns, rows } = grid;
  const turned = new Float32Array(columns * rows);
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      turned[column * rows + row] = heights[row * columns + column] as number;
    }
  }
  return {
    heights: turned,
    grid: { columns: rows, rows: columns, cellWidth: grid.cellHeight, cellHeight: grid.cellWidth },
  };
}

/**
 * Spiral finishing over `setup`, whose grid is along the stock's axes, in
 * stock coordinates, yielding the fraction done from `FINISH_SETUP_SHARE`
 * on.
 *
 * The spiral (`spiralRuns`) covers the model's outline with the tool's
 * centre on the cells' centres, its laps as many rows and columns apart as
 * fit in the operation's step-over, starting at the outline or in the
 * middle as the strategy says. The tool is dropped onto the model at every
 * cell along each run (along columns, on the heights turned a quarter turn,
 * so both are as quick as parallel passes), and the samples merged into
 * straight moves with `simplifyHeights`, which never cuts below them. Where
 * the tool rises or drops more than a cell's size between two samples, as
 * at a wall a flat end mill drops off, the model may rise above the
 * straight move between them, so the tool goes over at the higher one
 * instead. It enters with a rapid down to the entry clearance and a plunge,
 * and stays down to the end.
 *
 * With rest machining, it only cuts where the tool meets more than
 * `REST_MATERIAL` of the stock left, retracting across the gaps.
 */
export function* spiralSteps(
  operation: ReliefFinishOperation,
  { grid, heights, profile, dropper, floor, restDropper, warnings }: FinishSetup,
  strategy: Extract<FinishingStrategy, { type: "spiral" }>,
  { safeZ, entryClearance }: Pick<ReliefFinishOptions, "safeZ" | "entryClearance">,
): Generator<number, Toolpath> {
  const { tool, params } = operation;
  const { columns, rows, cellWidth, cellHeight } = grid;
  const spacing = (tool.diameter * params.stepOver) / 100;
  const outwards = spiralRuns(
    columns,
    rows,
    Math.max(1, Math.floor(spacing / cellWidth + 1e-9)),
    Math.max(1, Math.floor(spacing / cellHeight + 1e-9)),
  );
  const runs = strategy.start === "centre" ? reversed(outwards) : outwards;
  const turned = transposed(heights, grid);
  const columnDropper = new ToolDropper(turned.heights, turned.grid, profile);

  const builder = new ToolpathBuilder(safeZ, entryClearance);
  const step = Math.min(cellWidth, cellHeight);
  const gap = Math.ceil(tool.diameter / step);
  const tips = new Float64Array(Math.max(columns, rows));
  /** Whether the tool is down at the end of the run before. */
  let atEnd = false;
  for (const [index, { along, line, from, to }] of runs.entries()) {
    const count = Math.abs(to - from) + 1;
    const samples = tips.subarray(0, count);
    samples.fill(floor);
    const low = Math.min(from, to);
    if (along === "row") dropper.dropLine((line + 0.5) * cellHeight, low, low + count - 1, samples);
    else columnDropper.dropLine((line + 0.5) * cellWidth, low, low + count - 1, samples);
    if (to < from) samples.reverse();
    const cell = (k: number) => from + (to < from ? -k : k);
    const at = (k: number, z = samples[k] as number): [number, number, number] => {
      const [u, v] =
        along === "row"
          ? [(cell(k) + 0.5) * cellWidth, (line + 0.5) * cellHeight]
          : [(line + 0.5) * cellWidth, (cell(k) + 0.5) * cellHeight];
      return [...toStock(grid, u, v), z];
    };
    const runsLeft: [number, number][] = restDropper
      ? remainingRuns(
          (k) => {
            const [u, v] =
              along === "row"
                ? [(cell(k) + 0.5) * cellWidth, (line + 0.5) * cellHeight]
                : [(line + 0.5) * cellWidth, (cell(k) + 0.5) * cellHeight];
            return restDropper.remaining(u, v, samples[k] as number);
          },
          count,
          gap,
        )
      : [[0, count - 1]];
    const over = (k: number) =>
      Math.abs((samples[k + 1] as number) - (samples[k] as number)) > step;
    let continues = atEnd;
    atEnd = false;
    for (const [a, b] of runsLeft) {
      // The first sample is the last of the run before, where the tool may already be.
      if (!(continues && a === 0)) {
        const start = at(a);
        builder.travel(start[0], start[1]);
        builder.rapid([start[0], start[1], Math.max(builder.clearance, start[2])]);
        builder.feed(start, tool.plungeRate);
      }
      continues = false;
      let first = a;
      for (let k = a; k <= b; k++) {
        if (k < b && !over(k)) continue;
        for (const i of simplifyHeights(samples.subarray(first, k + 1), RELIEF_TOLERANCE)) {
          if (i > 0) builder.feed(at(first + i), tool.feedRate);
        }
        if (k < b) {
          const high = Math.max(samples[k] as number, samples[k + 1] as number);
          builder.feed(at(k, high), tool.feedRate);
          builder.feed(at(k + 1, high), tool.feedRate);
          builder.feed(at(k + 1), tool.feedRate);
        }
        first = k + 1;
      }
      atEnd = b === count - 1;
    }
    yield FINISH_SETUP_SHARE + ((1 - FINISH_SETUP_SHARE) * (index + 1)) / runs.length;
  }
  builder.retract();
  return { moves: builder.moves, warnings };
}
