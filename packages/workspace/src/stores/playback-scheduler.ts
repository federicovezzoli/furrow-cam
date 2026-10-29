import type { HeightmapGrid, SimulationCut } from "@furrow/cam-core";
import type { FlipAxis, Stock } from "@furrow/document";

/**
 * Starts a playback's heightmap in its worker (ADR-0004), from the uncut
 * stock or, with `before`, from the stock the top side's cuts leave, turned
 * over about `axis` (the bottom side of a two-sided project, ADR-0060).
 */
export type PlaybackLoad = {
  type: "load";
  key: string;
  stock: Pick<Stock, "width" | "height" | "thickness">;
  cuts: SimulationCut[];
  before?: { cuts: SimulationCut[]; axis: FlipAxis };
  /** Most cells the heightmap may have, so the device can draw it. */
  maxCells: number;
};

/** Sweeps the heightmap to `move` whole moves and `fraction` of the next (`heightmapPlayback`). */
export type PlaybackSeek = { type: "seek"; key: string; move: number; fraction: number };

export type PlaybackRequest = PlaybackLoad | PlaybackSeek;

/**
 * `loaded` gives the grid and the heights the playback starts from (all cells
 * at the stock top when `heights` is missing); each `frame` the cells from
 * `start` that a seek changed (none when `values` is empty).
 */
export type PlaybackResponse = { key: string } & (
  | { type: "loaded"; grid: HeightmapGrid; heights?: Float32Array }
  | { type: "frame"; start: number; values: Float32Array }
  | { type: "error"; error: string }
);

/**
 * Talks to a playback's worker, one seek at a time: while it sweeps, only the
 * latest seek waits, and it is sent when the worker answers, so scrubbing
 * never queues up work. Responses to an earlier `load` are dropped. `fail`
 * reports the worker as stopped, e.g. when it crashed.
 */
export function schedulePlayback(
  post: (request: PlaybackRequest) => void,
  handlers: {
    onLoaded: (grid: HeightmapGrid, heights?: Float32Array) => void;
    onFrame: (start: number, values: Float32Array) => void;
    onError: (error: string) => void;
  },
) {
  let key: string | null = null;
  let loaded = false;
  let inFlight = false;
  let waiting: { move: number; fraction: number } | null = null;
  let sent: { move: number; fraction: number } | null = null;

  function send(at: { move: number; fraction: number }) {
    if (key === null) return;
    inFlight = true;
    sent = at;
    post({ type: "seek", key, ...at });
  }

  function next() {
    const at = waiting;
    waiting = null;
    if (at && (at.move !== sent?.move || at.fraction !== sent?.fraction)) send(at);
  }

  return {
    load(request: Omit<PlaybackLoad, "type">) {
      key = request.key;
      loaded = false;
      inFlight = true;
      // A seek queued for the last path would land elsewhere on this one.
      waiting = null;
      sent = { move: 0, fraction: 0 };
      post({ type: "load", ...request });
    },
    seek(move: number, fraction: number) {
      if (key === null) return;
      if (!loaded || inFlight) waiting = { move, fraction };
      else if (move !== sent?.move || fraction !== sent?.fraction) send({ move, fraction });
    },
    receive(response: PlaybackResponse) {
      if (response.key !== key) return;
      inFlight = false;
      if (response.type === "loaded") {
        loaded = true;
        handlers.onLoaded(response.grid, response.heights);
      } else if (response.type === "frame") {
        handlers.onFrame(response.start, response.values);
      } else {
        handlers.onError(response.error);
        return;
      }
      next();
    },
    fail(error: string) {
      if (key === null) return;
      key = null;
      handlers.onError(error);
    },
  };
}
