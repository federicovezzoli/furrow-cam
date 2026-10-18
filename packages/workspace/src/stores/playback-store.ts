import { createStore } from "zustand/vanilla";

/** The speeds a playback can run at. */
export const PLAYBACK_SPEEDS = [1, 2, 5, 10, 25, 50, 100] as const;
export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number];

/**
 * Millimetres of path a playback covers each second at 1×: 1500 mm/min, a
 * typical feed. The timeline is proportional to path length, not machining
 * time, so rapids take as long as feeds of the same length.
 */
export const PLAYBACK_MM_PER_SECOND = 25;

/**
 * Where a playback is (#100): `distance` travelled along its path in
 * millimetres, whether it is `playing`, and how fast. Changes every frame
 * while playing, so it has no undo or devtools, and the viewport reads it in
 * its frame loop rather than re-rendering.
 */
export type PlaybackState = {
  distance: number;
  playing: boolean;
  speed: PlaybackSpeed;
  setDistance: (distance: number) => void;
  setPlaying: (playing: boolean) => void;
  setSpeed: (speed: PlaybackSpeed) => void;
};

export type PlaybackStore = ReturnType<typeof createPlaybackStore>;

export function createPlaybackStore() {
  return createStore<PlaybackState>()((set) => ({
    distance: 0,
    playing: false,
    speed: 10,
    setDistance: (distance) => set({ distance: Math.max(0, distance) }),
    setPlaying: (playing) => set({ playing }),
    setSpeed: (speed) => set({ speed }),
  }));
}

/**
 * Advances `distance` by `seconds` at `speed`, up to `length`; `done` once it
 * reaches the end.
 */
export function advance(
  distance: number,
  seconds: number,
  speed: PlaybackSpeed,
  length: number,
): { distance: number; done: boolean } {
  const next = Math.min(distance + seconds * speed * PLAYBACK_MM_PER_SECOND, length);
  return { distance: next, done: next >= length };
}
