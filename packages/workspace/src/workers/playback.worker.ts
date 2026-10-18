import {
  type HeightmapPlayback,
  heightmapGrid,
  heightmapPlayback,
  playbackPath,
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
 * cells that changed.
 */
scope.onmessage = ({ data: request }) => {
  const { key } = request;
  try {
    if (request.type === "load") {
      const { stock, cuts, maxCells } = request;
      const grid = heightmapGrid(stock, smallestCutWidth(cuts), maxCells);
      current = { key, playback: heightmapPlayback(stock, playbackPath(cuts), grid) };
      scope.postMessage({ key, type: "loaded", grid });
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
