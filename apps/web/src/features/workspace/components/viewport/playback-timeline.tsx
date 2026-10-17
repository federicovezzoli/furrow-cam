"use client";

import { fromMillimetres, moveStartDistance, type PlaybackPath } from "@furrow/cam-core";
import type { Units } from "@furrow/document";
import { PauseIcon, PlayIcon, SkipBackIcon, SkipForwardIcon } from "lucide-react";
import { useStore } from "zustand";
import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import type { PlaybackPart } from "@/features/workspace/lib/playback-moves";
import {
  PLAYBACK_SPEEDS,
  type PlaybackSpeed,
  type PlaybackStore,
} from "@/features/workspace/stores/playback-store";

/**
 * The playback's timeline (#100): play and pause, speed, scrubbing along the
 * path (its length, not machining time) and a mark at the start of each
 * operation, with buttons to jump between them. `status` says what the
 * simulation is doing, if anything worth saying. Distances show in `units`.
 */
export function PlaybackTimeline({
  store,
  path,
  parts,
  units,
  status,
}: {
  store: PlaybackStore;
  path: PlaybackPath | null;
  parts: PlaybackPart[];
  units: Units;
  status: string[];
}) {
  const distance = useStore(store, (s) => s.distance);
  const playing = useStore(store, (s) => s.playing);
  const speed = useStore(store, (s) => s.speed);
  const length = path?.length ?? 0;
  const starts = path ? parts.map((part) => moveStartDistance(path, part.firstMove)) : [];
  // The part under way: the last one started.
  const current = starts.findLastIndex((start) => start <= distance);
  const empty = length === 0;
  const { setDistance, setPlaying, setSpeed } = store.getState();

  function jump(direction: -1 | 1) {
    // Back goes to the start of the part under way, or the one before when at its start.
    const target =
      direction === 1
        ? starts.find((start) => start > distance)
        : starts.findLast((start) => start < distance - JUMP_SLACK);
    setDistance(target ?? (direction === 1 ? length : 0));
  }

  return (
    <section
      aria-label="Playback"
      className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-t bg-background px-2 py-1.5"
    >
      <div className="flex items-center gap-0.5">
        <Button
          variant="ghost"
          size="icon-compact"
          aria-label="Previous operation"
          title="Back to the start of the operation"
          disabled={empty}
          onClick={() => jump(-1)}
        >
          <SkipBackIcon />
        </Button>
        <Button
          variant="secondary"
          size="icon-compact"
          aria-label={playing ? "Pause" : "Play"}
          title={playing ? "Pause" : "Play"}
          disabled={empty}
          onClick={() => setPlaying(!playing)}
        >
          {playing ? <PauseIcon /> : <PlayIcon />}
        </Button>
        <Button
          variant="ghost"
          size="icon-compact"
          aria-label="Next operation"
          title="Forward to the next operation"
          disabled={empty}
          onClick={() => jump(1)}
        >
          <SkipForwardIcon />
        </Button>
      </div>
      <div className="relative flex min-w-40 flex-1 items-center">
        <input
          type="range"
          aria-label="Position along the toolpaths"
          className="h-control w-full accent-primary"
          min={0}
          max={length}
          step="any"
          value={Math.min(distance, length)}
          disabled={empty}
          onChange={(event) => setDistance(Number(event.currentTarget.value))}
        />
        {length > 0 &&
          parts.map((part, i) => (
            <button
              key={`${part.operationId}:${part.clearing}`}
              type="button"
              aria-label={`Jump to ${part.name}`}
              title={part.name}
              onClick={() => setDistance(starts[i] ?? 0)}
              className="absolute top-0 h-1.5 w-1 -translate-x-1/2 rounded-sm"
              style={{ left: `${((starts[i] ?? 0) / length) * 100}%`, background: part.color }}
            />
          ))}
      </div>
      <NativeSelect
        aria-label="Playback speed"
        className="h-control px-2 pr-7 text-ui"
        value={speed}
        onChange={(event) => setSpeed(Number(event.currentTarget.value) as PlaybackSpeed)}
      >
        {PLAYBACK_SPEEDS.map((value) => (
          <NativeSelectOption key={value} value={value}>
            {value}×
          </NativeSelectOption>
        ))}
      </NativeSelect>
      <p className="min-w-0 truncate text-ui text-muted-foreground tabular-nums" aria-live="off">
        {status.length > 0
          ? status.join(" ")
          : `${parts[current]?.name ?? ""} ${lengthLabel(distance, units)} / ${lengthLabel(length, units)}`}
      </p>
    </section>
  );
}

/** How close after an operation's start "back" still goes to the one before, in millimetres. */
const JUMP_SLACK = 1;

function lengthLabel(millimetres: number, units: Units): string {
  const value = fromMillimetres(millimetres, units);
  return `${value.toFixed(units === "in" ? 1 : 0)} ${units}`;
}
