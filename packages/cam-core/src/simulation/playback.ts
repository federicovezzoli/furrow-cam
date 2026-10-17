import type { Stock } from "@furrow/document";
import type { Vec3 } from "../scene/stock";
import {
  type CutterProfile,
  cutterProfile,
  type Heightmap,
  type HeightmapGrid,
  type SimulationCut,
  sweepMoves,
} from "./simulation";

/**
 * Cuts in the order they are made, for playing them back move by move (#100,
 * ADR-0042): each cut's `segments` in the order the tool moves, rapids
 * included. Progress along it is the distance the tool has travelled, so the
 * timeline is proportional to path length. Moves are numbered across all the
 * cuts, from `0`.
 */
export type PlaybackPath = {
  cuts: readonly SimulationCut[];
  /** The number of the first move of each cut, then the number of moves. */
  firstMoves: Uint32Array;
  /** The distance travelled at the end of each move. */
  ends: Float64Array;
  /** The distance travelled at the end of the last move. */
  length: number;
};

export function playbackPath(cuts: readonly SimulationCut[]): PlaybackPath {
  const firstMoves = new Uint32Array(cuts.length + 1);
  let count = 0;
  cuts.forEach(({ segments }, i) => {
    firstMoves[i] = count;
    count += Math.floor(segments.length / 6);
  });
  firstMoves[cuts.length] = count;
  const ends = new Float64Array(count);
  let length = 0;
  let move = 0;
  for (const { segments } of cuts) {
    for (let i = 0; i + 5 < segments.length; i += 6) {
      length += Math.hypot(
        (segments[i + 3] as number) - (segments[i] as number),
        (segments[i + 4] as number) - (segments[i + 1] as number),
        (segments[i + 5] as number) - (segments[i + 2] as number),
      );
      ends[move++] = length;
    }
  }
  return { cuts, firstMoves, ends, length };
}

/**
 * Where the tool is after travelling `distance` along `path`: `move` moves
 * are done and it is `fraction` of the way along the next (`0` at its start),
 * at `point`, with the tool of cut `cut`. At the end, `move` is the number of
 * moves and `point` the end of the last one. `null` for a path without moves.
 */
export type PlaybackPosition = { move: number; fraction: number; cut: number; point: Vec3 };

export function playbackPosition(path: PlaybackPath, distance: number): PlaybackPosition | null {
  const { ends, firstMoves } = path;
  const count = ends.length;
  if (count === 0) return null;
  // The first move that ends past `distance` is the one under way.
  let low = 0;
  let high = count;
  while (low < high) {
    const mid = (low + high) >> 1;
    if ((ends[mid] as number) > distance) high = mid;
    else low = mid + 1;
  }
  const move = low;
  if (move === count) {
    const cut = cutOf(firstMoves, count - 1);
    return { move, fraction: 0, cut, point: moveEnd(path, cut, count - 1) };
  }
  const start = move === 0 ? 0 : (ends[move - 1] as number);
  const length = (ends[move] as number) - start;
  const fraction = length > 0 ? Math.min(Math.max((distance - start) / length, 0), 1) : 0;
  const cut = cutOf(firstMoves, move);
  const segments = (path.cuts[cut] as SimulationCut).segments;
  const i = (move - (firstMoves[cut] as number)) * 6;
  const point: Vec3 = [0, 0, 0];
  for (let axis = 0; axis < 3; axis++) {
    const a = segments[i + axis] as number;
    point[axis] = a + ((segments[i + 3 + axis] as number) - a) * fraction;
  }
  return { move, fraction, cut, point };
}

/** The distance travelled when move `move` starts. */
export function moveStartDistance(path: PlaybackPath, move: number): number {
  return move <= 0 ? 0 : (path.ends[Math.min(move, path.ends.length) - 1] ?? 0);
}

/** The cut move `move` belongs to. */
function cutOf(firstMoves: Uint32Array, move: number): number {
  let low = 0;
  let high = firstMoves.length - 2;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if ((firstMoves[mid] as number) <= move) low = mid;
    else high = mid - 1;
  }
  return low;
}

function moveEnd(path: PlaybackPath, cut: number, move: number): Vec3 {
  const segments = (path.cuts[cut] as SimulationCut).segments;
  const i = (move - (path.firstMoves[cut] as number)) * 6;
  return [segments[i + 3] as number, segments[i + 4] as number, segments[i + 5] as number];
}

/** Cells `start` to `end - 1` of a heightmap, as in `Heightmap.heights`. */
export type CellRange = { start: number; end: number };

/**
 * Memory the checkpoints of a `heightmapPlayback` may take: eight copies of
 * the largest heightmap.
 */
const CHECKPOINT_BYTES = 256 * 1024 * 1024;

/** Most checkpoints a `heightmapPlayback` keeps, however small its heightmap. */
const MAX_CHECKPOINTS = 64;

/**
 * The stock as `simulateCuts` would leave it after part of `path`, kept up to
 * date as the playback moves (ADR-0019, ADR-0042). `seek` sweeps only the
 * moves between the last position and the new one: forwards from where it
 * is, backwards from the last checkpoint before it, a copy of the heights
 * kept every so many moves as the playback first passes them. Part of a move
 * is swept too, after saving the cells it may change, so the next `seek`
 * puts them back first.
 *
 * `heightmap.heights` changes in place; `seek` returns the cells it changed
 * (`null` for none), for a renderer to upload only those. Its buffer is
 * padded as `simulateCuts` pads it, by `bufferMultiple`.
 */
export type HeightmapPlayback = {
  heightmap: Heightmap;
  seek: (move: number, fraction: number) => CellRange | null;
};

export function heightmapPlayback(
  stock: Pick<Stock, "thickness">,
  path: PlaybackPath,
  grid: HeightmapGrid,
  bufferMultiple = 1,
): HeightmapPlayback {
  const { columns, rows, cellHeight } = grid;
  const cells = columns * rows;
  const padded = Math.ceil(cells / bufferMultiple) * bufferMultiple;
  const heights = new Float32Array(new ArrayBuffer(padded * 4), 0, cells);
  const heightmap: Heightmap = { ...grid, heights };
  const bottom = -stock.thickness;
  const profiles: CutterProfile[] = path.cuts.map(({ tool }) => cutterProfile(tool));
  const count = path.ends.length;
  const kept = Math.max(1, Math.min(MAX_CHECKPOINTS, Math.floor(CHECKPOINT_BYTES / (cells * 4))));
  /** Moves between checkpoints. */
  const interval = Math.max(1, Math.ceil(count / kept));
  /** Checkpoint `k` holds the heights after `k * interval` moves; the first is the uncut stock. */
  const checkpoints: (Float32Array | undefined)[] = [];
  /** Whole moves swept into `heights`. */
  let done = 0;
  /** The cells part of a move changed, as they were before. */
  let partial: { start: number; saved: Float32Array } | null = null;
  const scratch = new Float32Array(6);

  /** The cells a move from `ay` to `by` may change, rows across; `null` above the stock. */
  function reach(ay: number, az: number, by: number, bz: number, radius: number) {
    if (Math.min(az, bz) >= 0) return null;
    const first = Math.max(0, Math.floor((Math.min(ay, by) - radius) / cellHeight - 0.5));
    const last = Math.min(rows - 1, Math.ceil((Math.max(ay, by) + radius) / cellHeight - 0.5));
    return last < first ? null : { start: first * columns, end: (last + 1) * columns };
  }

  return {
    heightmap,
    seek(move, fraction) {
      const target = Math.min(Math.max(Math.floor(move), 0), count);
      let changed: CellRange | null = null;
      const touch = (range: CellRange | null) => {
        if (!range) return;
        changed = changed
          ? { start: Math.min(changed.start, range.start), end: Math.max(changed.end, range.end) }
          : { ...range };
      };

      if (partial) {
        heights.set(partial.saved, partial.start);
        touch({ start: partial.start, end: partial.start + partial.saved.length });
        partial = null;
      }
      if (target < done) {
        const k = Math.floor(target / interval);
        let from = k;
        while (from > 0 && !checkpoints[from]) from--;
        const checkpoint = checkpoints[from];
        if (checkpoint) heights.set(checkpoint);
        else heights.fill(0);
        done = from * interval;
        touch({ start: 0, end: cells });
      }
      for (let cut = 0; done < target; cut++) {
        const first = path.firstMoves[cut] as number;
        const next = path.firstMoves[cut + 1] as number;
        if (next <= done) continue;
        const { segments } = path.cuts[cut] as SimulationCut;
        const profile = profiles[cut] as CutterProfile;
        while (done < target && done < next) {
          // Up to the next checkpoint at most, to take it on the way.
          const stop = Math.min(target, next, (Math.floor(done / interval) + 1) * interval);
          for (let m = done; m < stop; m++) {
            const i = (m - first) * 6;
            touch(
              reach(
                segments[i + 1] as number,
                segments[i + 2] as number,
                segments[i + 4] as number,
                segments[i + 5] as number,
                profile.radius,
              ),
            );
          }
          sweepMoves(grid, heights, profile, segments, done - first, stop - first);
          done = stop;
          const k = done / interval;
          if (Number.isInteger(k) && !checkpoints[k]) checkpoints[k] = heights.slice();
        }
      }
      if (fraction > 0 && target < count) {
        const cut = cutOf(path.firstMoves, target);
        const { segments } = path.cuts[cut] as SimulationCut;
        const profile = profiles[cut] as CutterProfile;
        const i = (target - (path.firstMoves[cut] as number)) * 6;
        for (let axis = 0; axis < 3; axis++) {
          const a = segments[i + axis] as number;
          scratch[axis] = a;
          scratch[3 + axis] = a + ((segments[i + 3 + axis] as number) - a) * Math.min(fraction, 1);
        }
        const range = reach(
          scratch[1] as number,
          scratch[2] as number,
          scratch[4] as number,
          scratch[5] as number,
          profile.radius,
        );
        if (range) {
          partial = { start: range.start, saved: heights.slice(range.start, range.end) };
          sweepMoves(grid, heights, profile, scratch, 0, 1);
          touch(range);
        }
      }

      const result = changed as CellRange | null;
      if (result) {
        for (let c = result.start; c < result.end; c++) {
          if ((heights[c] as number) < bottom) heights[c] = bottom;
        }
      }
      return result;
    },
  };
}
