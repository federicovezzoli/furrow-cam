"use client";

import {
  type CellRange,
  type Heightmap,
  machinedDocument,
  type PlaybackPath,
  playbackPath,
  playbackPosition,
} from "@furrow/cam-core";
import type { FlipAxis, StockSide } from "@furrow/document";
import { lazyWorker } from "@furrow/ui/lib/lazy-worker";
import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import { useShallow } from "zustand/react/shallow";
import {
  moveLines,
  type PlaybackPart,
  type PlayedProgram,
  playbackKey,
  playedProgram,
  programParts,
} from "../lib/playback-moves";
import { programRequests } from "../lib/program-requests";
import { TEXTURE_WIDTH } from "../lib/simulation-mesh";
import { useWorkspaceHost } from "../providers/workspace-host";
import {
  useDocumentStore,
  useToolpathStore,
  useWorkspaceStore,
} from "../providers/workspace-stores";
import {
  type PlaybackRequest,
  type PlaybackResponse,
  schedulePlayback,
} from "../stores/playback-scheduler";
import { advance, createPlaybackStore, type PlaybackStore } from "../stores/playback-store";
import type { GcodeExportResult } from "../stores/toolpath-scheduler";
import { settledEntries } from "../stores/toolpath-store";

/** Tells a renderer which cells of a heightmap changed in place. */
export type HeightmapUpdates = {
  subscribe: (listener: (range: CellRange) => void) => () => void;
};

type Loaded = {
  heightmap: Heightmap;
  /** The side the heightmap shows. */
  side: StockSide;
  /** The stock the heightmap is on, which may differ from the current one. */
  stock: { width: number; height: number; thickness: number };
};

/**
 * Playback of the open project's program (#683, ADR-0096), while `maxCells`
 * is set: the G-code posted from the toolpaths computed, read back in the
 * toolpath worker. Where the tool is (`store`), along which moves (`path`,
 * `parts`), and the stock it has cut so far, swept in a Web Worker as the
 * playback moves (ADR-0004, ADR-0019); what reading the program back said
 * (`program`). `heightmap` changes in place; `updates` says which cells did.
 * While toolpaths recompute or the program is made, the last moves and stock
 * stay, `pending` is true and the playback is paused: it neither plays nor
 * cuts until the new moves are in. In a two-sided project it plays the side the
 * workspace shows, the bottom side over the stock the top side left (ADR-0060);
 * switching sides starts that side's playback from the beginning, and nothing
 * of the other side's shows meanwhile. Derived data: none of it is saved.
 */
export function usePlayback(maxCells: number | null) {
  // As machined: operations that only cut hidden objects are off (ADR-0080).
  const operations = useDocumentStore((s) => machinedDocument(s.document).operations);
  const { width, height, thickness } = useDocumentStore((s) => s.document.stock);
  const flipAxis = useDocumentStore((s) => s.document.stock.twoSided?.flipAxis ?? null);
  // Always the top side unless the project is two-sided (`prune`).
  const side = useWorkspaceStore((s) => s.side);
  const entries = useToolpathStore(useShallow(settledEntries));
  const [store] = useState(createPlaybackStore);
  const [listeners] = useState(() => new Set<(range: CellRange) => void>());
  const [updates] = useState<HeightmapUpdates>(() => ({
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  }));
  const enabled = maxCells !== null;
  // What the post writes besides the toolpaths: the machine's blocks, the
  // stock's zero, and tool names, which tell bits apart (`sameBit`) but not toolpaths.
  const machine = useDocumentStore((s) => s.document.machine);
  const stock = useDocumentStore((s) => s.document.stock);

  const latest = useMemo(() => {
    if (!enabled) return null;
    const posted = [machine, stock, operations.map((operation) => operation.tool.name)];
    return playbackKey(operations, entries, side, flipAxis, posted);
  }, [enabled, operations, entries, side, flipAxis, machine, stock]);
  // Kept while toolpaths recompute or the next program is made.
  const [moves, setMoves] = useState<PlayedProgram | null>(null);
  useProgram(latest, moves?.key ?? null, flipAxis, setMoves);
  // The other side's moves would play over this side's stock.
  if (moves !== null && moves.side !== (flipAxis ? side : "top")) setMoves(null);
  if (!enabled && moves !== null) setMoves(null);
  const path = useMemo(() => (moves ? playbackPath(moves.cuts) : null), [moves]);
  const computing = enabled && (latest === null || latest.key !== moves?.key);
  const computingRef = useRef(computing);
  computingRef.current = computing;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const schedule = useRef<ReturnType<typeof schedulePlayback> | null>(null);
  const pathRef = useRef<PlaybackPath | null>(null);
  /** The stock and side of the latest load. */
  const stockRef = useRef<Pick<Loaded, "stock" | "side"> | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let heights: Float32Array | null = null;
    const worker = lazyWorker<PlaybackRequest, PlaybackResponse>(
      () =>
        new Worker(new URL("../workers/playback.worker.ts", import.meta.url), { type: "module" }),
      {
        onMessage: (response) => scheduler.receive(response),
        onFail: (failure) => scheduler.fail(failure),
        failures: {
          stopped: "The playback worker stopped",
          unreadable: "The playback couldn't be read from the worker",
        },
      },
    );
    const scheduler = schedulePlayback((request) => worker.post(request), {
      onLoaded(grid, start) {
        const cells = grid.columns * grid.rows;
        // Padded to whole texture rows, so the viewport uploads it without a copy.
        const padded = Math.ceil(cells / TEXTURE_WIDTH) * TEXTURE_WIDTH;
        heights = new Float32Array(new ArrayBuffer(padded * 4), 0, cells);
        if (start) heights.set(start);
        const last = stockRef.current;
        setLoaded(last && { heightmap: { ...grid, heights }, ...last });
        setError(null);
        seekTo(store.getState().distance);
      },
      onFrame(start, values) {
        if (!heights || values.length === 0) return;
        heights.set(values, start);
        const range = { start, end: start + values.length };
        for (const listener of listeners) listener(range);
      },
      onError: setError,
      onBusy: (sweeping) => store.setState({ sweeping }),
    });
    schedule.current = scheduler;
    function seekTo(distance: number) {
      if (computingRef.current) return;
      const at = pathRef.current && playbackPosition(pathRef.current, distance);
      if (at) scheduler.seek(at.move, at.fraction);
    }
    const stop = store.subscribe((state, previous) => {
      if (state.distance !== previous.distance) seekTo(state.distance);
    });
    return () => {
      stop();
      worker.terminate();
      // A load or seek in flight never answers now.
      store.setState({ sweeping: false });
      schedule.current = null;
      setLoaded(null);
      setError(null);
    };
  }, [enabled, store, listeners]);

  useEffect(() => {
    pathRef.current = path;
    if (!path || !moves || maxCells === null) return;
    const { distance } = store.getState();
    if (distance > path.length) store.getState().setDistance(path.length);
    stockRef.current = { stock: { width, height, thickness }, side: moves.side };
    schedule.current?.load({
      key: `${moves.key}:${width}x${height}x${thickness}:${maxCells}`,
      stock: { width, height, thickness },
      cuts: moves.cuts,
      before: moves.before,
      maxCells,
    });
  }, [path, moves, width, height, thickness, maxCells, store]);

  // A new side plays back from its start.
  const playedSide = useRef(side);
  useEffect(() => {
    if (side === playedSide.current) return;
    playedSide.current = side;
    const { setPlaying, setDistance } = store.getState();
    setPlaying(false);
    setDistance(0);
  }, [side, store]);

  useEffect(() => {
    if (computing) store.getState().setPlaying(false);
  }, [computing, store]);
  usePlaybackClock(store, path?.length ?? 0, computing);

  // With names and colours as they are now: renaming an operation or
  // recolouring its tool doesn't change its toolpath. Kept while they recompute.
  const lastParts = useRef<PlaybackPart[]>([]);
  const current = latest !== null && latest.key === moves?.key;
  const parts = useMemo(
    () =>
      !moves
        ? []
        : current
          ? programParts(moves.steps, moves.lines, operations, entries)
          : lastParts.current,
    [moves, current, operations, entries],
  );
  lastParts.current = parts;
  const lines = useMemo(() => moveLines(moves?.lines ?? []), [moves]);
  // The other side's stock would show until this side's loads.
  const shown = loaded?.side === side ? loaded : null;
  return {
    store,
    side,
    path,
    parts,
    heightmap: shown?.heightmap ?? null,
    stock: shown?.stock ?? null,
    updates,
    error,
    program: moves && {
      warnings: moves.warnings,
      failure: moves.failure,
      gcode: moves.gcode,
      blocks: moves.blocks,
      lines,
    },
    pending: computing || (enabled && shown === null),
  };
}

/**
 * Asks the toolpath worker for the program `latest` keys whenever it differs
 * from the one played (`played`), one at a time (`programRequests`). The
 * answer goes to `onProgram`.
 */
function useProgram(
  latest: ReturnType<typeof playbackKey>,
  played: string | null,
  flipAxis: FlipAxis | null,
  onProgram: (program: PlayedProgram) => void,
) {
  const controls = useToolpathStore((s) => s.controls);
  const { name } = useWorkspaceHost().project;
  const refs = useRef({ latest, flipAxis, name, onProgram });
  refs.current = { latest, flipAxis, name, onProgram };
  const requests = useRef<{ update: (played: string | null) => void } | null>(null);
  useEffect(() => {
    const made = programRequests(
      (wanted: NonNullable<typeof latest>) =>
        controls
          .exportGcode(() => refs.current.name, { simulate: wanted.side })
          .catch(
            (error: unknown): GcodeExportResult => ({
              error: error instanceof Error ? error.message : String(error),
            }),
          ),
      () => refs.current.latest,
      (wanted, result) =>
        refs.current.onProgram(playedProgram(wanted, result, refs.current.flipAxis)),
    );
    requests.current = made;
    return () => {
      made.stop();
      requests.current = null;
    };
  }, [controls]);
  // `controls` too: new requests ask for the program again.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `latest` and `controls` trigger it, read through refs
  useEffect(() => requests.current?.update(played), [latest, played, controls]);
}

/** Moves `store`'s playback along while it is playing, stopping at `length`; not while `held`. */
export function usePlaybackClock(store: PlaybackStore, length: number, held = false) {
  const playing = useStore(store, (s) => s.playing);
  useEffect(() => {
    if (!playing) return;
    if (held) {
      store.getState().setPlaying(false);
      return;
    }
    let frame = 0;
    let last: number | null = null;
    function tick(now: number) {
      const state = store.getState();
      // At the end, playing starts over.
      if (last === null && state.distance >= length) state.setDistance(0);
      const seconds = last === null ? 0 : (now - last) / 1000;
      last = now;
      const { distance, done } = advance(store.getState().distance, seconds, state.speed, length);
      state.setDistance(distance);
      if (done) state.setPlaying(false);
      else frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, store, length, held]);
}
