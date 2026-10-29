import {
  flipHeightmap,
  type HeightmapGrid,
  type HeightmapPlayback,
  heightmapGrid,
  heightmapPlayback,
  playbackPath,
  simulateCuts,
  smallestCutWidth,
} from "@furrow/cam-core";
import type { PlaybackRequest, PlaybackResponse } from "../stores/playback-scheduler";

/** The worker's global scope; the app's TypeScript lib describes a window instead. */
const scope = self as unknown as {
  onmessage: (event: MessageEvent<PlaybackRequest>) => void;
  postMessage: (response: PlaybackResponse, transfer?: Transferable[]) => void;
};

let current: { key: string; playback: HeightmapPlayback } | null = null;

/** The top side's flipped heightmap last loaded for the bottom side, kept while its cuts, stock and grid stay the same. */
let flippedTop: { key: string; grid: HeightmapGrid; heights: Float32Array } | null = null;

/**
 * Keeps a playback's heightmap (#100) off the main thread (ADR-0004): on the
 * same grid as the whole simulation (ADR-0019), so its end matches it, and
 * swept incrementally as the playback seeks. Each frame sends back only the
 * cells that changed. The bottom side of a two-sided project starts from the
 * top side's stock, flipped, as the simulation does (ADR-0060).
 */
scope.onmessage = ({ data: request }) => {
  const { key } = request;
  try {
    if (request.type === "load") {
      const { stock, cuts, before, maxCells } = request;
      const all = before ? [...before.cuts, ...cuts] : cuts;
      const grid = heightmapGrid(stock, smallestCutWidth(all), maxCells);
      if (before) {
        const topKey = JSON.stringify([before.key, before.axis, stock]);
        if (!flippedTop || flippedTop.key !== topKey || !sameGrid(flippedTop.grid, grid)) {
          const heights = flipHeightmap(simulateCuts(stock, before.cuts, grid), before.axis);
          flippedTop = { key: topKey, grid, heights };
        }
      }
      const top = before ? flippedTop?.heights : undefined;
      const playback = heightmapPlayback(stock, playbackPath(cuts), grid, 1, top);
      current = { key, playback };
      if (!top) {
        scope.postMessage({ key, type: "loaded", grid });
        return;
      }
      const heights = playback.heightmap.heights.slice();
      scope.postMessage({ key, type: "loaded", grid, heights }, [heights.buffer]);
      return;
    }
    if (current?.key !== key) return;
    const { heights } = current.playback.heightmap;
    const changed = current.playback.seek(request.move, request.fraction);
    const values = changed ? heights.slice(changed.start, changed.end) : new Float32Array();
    scope.postMessage({ key, type: "frame", start: changed?.start ?? 0, values }, [values.buffer]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    scope.postMessage({ key, type: "error", error: message });
  }
};

/** The stock is in the key, so the cell counts fix the cells' size too. */
function sameGrid(a: HeightmapGrid, b: HeightmapGrid) {
  return a.columns === b.columns && a.rows === b.rows;
}
