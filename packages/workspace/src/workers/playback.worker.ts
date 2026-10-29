import {
  flipHeightmap,
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
      const flippedTop = before
        ? flipHeightmap(simulateCuts(stock, before.cuts, grid), before.axis)
        : undefined;
      const playback = heightmapPlayback(stock, playbackPath(cuts), grid, 1, flippedTop);
      current = { key, playback };
      if (!flippedTop) {
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
