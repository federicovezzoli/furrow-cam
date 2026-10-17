import { describe, expect, it } from "vitest";
import { advance, createPlaybackStore, PLAYBACK_MM_PER_SECOND } from "./playback-store";

describe("advance", () => {
  it("covers the path at the speed asked for, stopping at its end", () => {
    expect(advance(10, 2, 1, 1000)).toEqual({
      distance: 10 + 2 * PLAYBACK_MM_PER_SECOND,
      done: false,
    });
    expect(advance(0, 1, 100, 1000)).toEqual({ distance: 1000, done: true });
  });
});

describe("createPlaybackStore", () => {
  it("starts paused at the beginning and never goes before it", () => {
    const store = createPlaybackStore();
    expect(store.getState()).toMatchObject({ distance: 0, playing: false });
    store.getState().setDistance(-5);
    expect(store.getState().distance).toBe(0);
  });
});
