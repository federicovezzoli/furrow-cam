import type { FinishingStrategy, ReliefFinishOperation } from "@furrow/document";
import type { HeightmapGrid } from "../../simulation/simulation";
import { type Toolpath, ToolpathBuilder } from "../toolpath";
import {
  FINISH_SETUP_SHARE,
  type FinishSetup,
  finishingDiameter,
  type ReliefFinishOptions,
  remainingRuns,
  sampleMoves,
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
 * The spiral (`spiralRuns`) covers the setup's area with the tool's
 * centre on the cells' centres, its laps as many rows and columns apart as
 * fit in the operation's step-over, starting at the outline or in the
 * middle as the strategy says. The tool is dropped onto the model at every
 * cell along each run (along columns, on the heights turned a quarter turn,
 * so both are as quick as parallel passes), and the samples merged into
 * straight moves with `sampleMoves`, which never cuts below them and goes
 * over at the higher sample where the tool rises or drops more than a
 * cell's size between two. It enters with a rapid down to the entry clearance and a plunge,
 * and stays down to the end.
 *
 * With rest machining, it only cuts where the tool meets more than
 * `REST_MATERIAL` of the stock left, retracting across the gaps.
 */
export function* spiralSteps(
  operation: ReliefFinishOperation,
  {
    grid,
    area,
    heights,
    profile,
    discs,
    dropper,
    floor,
    outside,
    restDropper,
    warnings,
  }: FinishSetup,
  strategy: Extract<FinishingStrategy, { type: "spiral" }>,
  { safeZ, entryClearance }: Pick<ReliefFinishOptions, "safeZ" | "entryClearance">,
): Generator<number, Toolpath> {
  const { tool, params } = operation;
  const { cellWidth, cellHeight } = grid;
  // The cells whose centres are in the area, inside the grid or past it; the
  // runs number them from the first.
  const us = area.map(([u]) => u);
  const vs = area.map(([, v]) => v);
  const column0 = Math.ceil(Math.min(...us) / cellWidth - 0.5);
  const row0 = Math.ceil(Math.min(...vs) / cellHeight - 0.5);
  const columns = Math.floor(Math.max(...us) / cellWidth - 0.5) - column0 + 1;
  const rows = Math.floor(Math.max(...vs) / cellHeight - 0.5) - row0 + 1;
  if (columns < 1 || rows < 1) return { moves: [], warnings };
  const spacing = (finishingDiameter(tool) * params.stepOver) / 100;
  const outwards = spiralRuns(
    columns,
    rows,
    Math.max(1, Math.floor(spacing / cellWidth + 1e-9)),
    Math.max(1, Math.floor(spacing / cellHeight + 1e-9)),
  );
  const runs = strategy.start === "centre" ? reversed(outwards) : outwards;
  const turned = transposed(heights, grid);
  const columnDropper = new ToolDropper(
    turned.heights,
    turned.grid,
    profile,
    discs.map(({ x, y, to, ...disc }) => ({ ...disc, x: y, y: x, to: to && [to[1], to[0]] })),
    outside,
  );

  const builder = new ToolpathBuilder(safeZ, entryClearance);
  const step = Math.min(cellWidth, cellHeight);
  const gap = Math.ceil(finishingDiameter(tool) / step);
  const tips = new Float64Array(Math.max(columns, rows));
  /** Whether the tool is down at the end of the run before. */
  let atEnd = false;
  for (const [index, { along, line, from, to }] of runs.entries()) {
    const count = Math.abs(to - from) + 1;
    const samples = tips.subarray(0, count);
    samples.fill(floor);
    const [across, along0] = along === "row" ? [row0, column0] : [column0, row0];
    const low = Math.min(from, to) + along0;
    if (along === "row") {
      dropper.dropLine((line + across + 0.5) * cellHeight, low, low + count - 1, samples);
    } else {
      columnDropper.dropLine((line + across + 0.5) * cellWidth, low, low + count - 1, samples);
    }
    if (to < from) samples.reverse();
    /** Sample `k` of the run (fractional between samples), in grid coordinates. */
    const position = (k: number): [number, number] => {
      const cell = from + (to < from ? -k : k);
      return along === "row"
        ? [(cell + column0 + 0.5) * cellWidth, (line + row0 + 0.5) * cellHeight]
        : [(line + column0 + 0.5) * cellWidth, (cell + row0 + 0.5) * cellHeight];
    };
    const at = (k: number, z = samples[k] as number): [number, number, number] => [
      ...toStock(grid, ...position(k)),
      z,
    ];
    const runsLeft: [number, number][] = restDropper
      ? remainingRuns(
          (k) => restDropper.remaining(...position(k), samples[k] as number),
          count,
          gap,
        )
      : [[0, count - 1]];
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
      const spacing = along === "row" ? cellWidth : cellHeight;
      const between = (i: number, f: number) => {
        const [x, y] = position(a + i + f);
        return dropper.dropPoint(x, y, floor);
      };
      for (const [i, z] of sampleMoves(samples.subarray(a, b + 1), spacing, between)) {
        // The first may climb straight up from where the tool is; the
        // builder drops a move that goes nowhere.
        builder.feed(at(a + i, z), tool.feedRate);
      }
      atEnd = b === count - 1;
    }
    yield FINISH_SETUP_SHARE + ((1 - FINISH_SETUP_SHARE) * (index + 1)) / runs.length;
  }
  builder.retract();
  return { moves: builder.moves, warnings };
}
