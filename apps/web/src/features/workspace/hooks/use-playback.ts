"use client";

import {
  type CellRange,
  type Heightmap,
  type PlaybackPath,
  playbackPath,
  playbackPosition,
} from "@furrow/cam-core";
import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import { type PlaybackPart, playbackMoves } from "@/features/workspace/lib/playback-moves";
import { TEXTURE_WIDTH } from "@/features/workspace/lib/simulation-mesh";
import {
  useDocumentStore,
  useToolpathStore,
} from "@/features/workspace/providers/workspace-stores";
import {
  type PlaybackRequest,
  type PlaybackResponse,
  schedulePlayback,
} from "@/features/workspace/stores/playback-scheduler";
import {
  advance,
  createPlaybackStore,
  type PlaybackStore,
} from "@/features/workspace/stores/playback-store";
import { lazyWorker } from "@/lib/lazy-worker";

/** Tells a renderer which cells of a heightmap changed in place. */
export type HeightmapUpdates = {
  subscribe: (listener: (range: CellRange) => void) => () => void;
};

type Loaded = {
  heightmap: Heightmap;
  /** The stock the heightmap is on, which may differ from the current one. */
  stock: { width: number; height: number; thickness: number };
};

/**
 * Playback of the open project's toolpaths (#100), while `maxCells` is set:
 * where the tool is (`store`), along which moves (`path`, `parts`), and the
 * stock it has cut so far, swept in a Web Worker as the playback moves
 * (ADR-0004, ADR-0019). `heightmap` changes in place; `updates` says which
 * cells did. While toolpaths recompute, the last moves stay and `pending` is
 * true. Derived data: none of it is saved.
 */
export function usePlayback(maxCells: number | null) {
  const operations = useDocumentStore((s) => s.document.operations);
  const { width, height, thickness } = useDocumentStore((s) => s.document.stock);
  const entries = useToolpathStore((s) => s.entries);
  const [store] = useState(createPlaybackStore);
  const [listeners] = useState(() => new Set<(range: CellRange) => void>());
  const [updates] = useState<HeightmapUpdates>(() => ({
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  }));
  const enabled = maxCells !== null;

  const latest = useMemo(
    () => (enabled ? playbackMoves(operations, entries) : null),
    [enabled, operations, entries],
  );
  // Kept while toolpaths recompute, and the same object while their key is.
  const [moves, setMoves] = useState(latest);
  if (latest !== null && latest.key !== moves?.key) setMoves(latest);
  if (!enabled && moves !== null) setMoves(null);
  const path = useMemo(() => (moves ? playbackPath(moves.cuts) : null), [moves]);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const schedule = useRef<ReturnType<typeof schedulePlayback> | null>(null);
  const pathRef = useRef<PlaybackPath | null>(null);
  /** The stock of the latest load. */
  const stockRef = useRef<Loaded["stock"] | null>(null);

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
      onLoaded(grid) {
        const cells = grid.columns * grid.rows;
        // Padded to whole texture rows, so the viewport uploads it without a copy.
        const padded = Math.ceil(cells / TEXTURE_WIDTH) * TEXTURE_WIDTH;
        heights = new Float32Array(new ArrayBuffer(padded * 4), 0, cells);
        const stock = stockRef.current;
        setLoaded(stock && { heightmap: { ...grid, heights }, stock });
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
    });
    schedule.current = scheduler;
    function seekTo(distance: number) {
      const at = pathRef.current && playbackPosition(pathRef.current, distance);
      if (at) scheduler.seek(at.move, at.fraction);
    }
    const stop = store.subscribe((state, previous) => {
      if (state.distance !== previous.distance) seekTo(state.distance);
    });
    return () => {
      stop();
      worker.terminate();
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
    stockRef.current = { width, height, thickness };
    schedule.current?.load({
      key: `${moves.key}:${width}x${height}x${thickness}:${maxCells}`,
      stock: { width, height, thickness },
      cuts: moves.cuts,
      maxCells,
    });
  }, [path, moves, width, height, thickness, maxCells, store]);

  usePlaybackClock(store, path?.length ?? 0);

  const parts: PlaybackPart[] = moves?.parts ?? [];
  return {
    store,
    path,
    parts,
    heightmap: loaded?.heightmap ?? null,
    stock: loaded?.stock ?? null,
    updates,
    error,
    pending: enabled && (latest === null || loaded === null),
  };
}

/** Moves `store`'s playback along while it is playing, stopping at `length`. */
export function usePlaybackClock(store: PlaybackStore, length: number) {
  const playing = useStore(store, (s) => s.playing);
  useEffect(() => {
    if (!playing) return;
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
  }, [playing, store, length]);
}
