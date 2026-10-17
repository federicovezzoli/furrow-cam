import { describe, expect, it } from "vitest";
import { type PlaybackRequest, schedulePlayback } from "./playback-scheduler";

const grid = { columns: 2, rows: 2, cellWidth: 1, cellHeight: 1 };
const load = {
  key: "a",
  stock: { width: 2, height: 2, thickness: 1 },
  cuts: [],
  maxCells: 100,
};

function setup() {
  const posted: PlaybackRequest[] = [];
  const frames: [number, number[]][] = [];
  const errors: string[] = [];
  let loaded = 0;
  const schedule = schedulePlayback((request) => posted.push(request), {
    onLoaded: () => loaded++,
    onFrame: (start, values) => frames.push([start, [...values]]),
    onError: (error) => errors.push(error),
  });
  return { schedule, posted, frames, errors, loaded: () => loaded };
}

describe("schedulePlayback", () => {
  it("seeks only once loaded, with the latest position", () => {
    const { schedule, posted, loaded } = setup();
    schedule.load(load);
    schedule.seek(3, 0.5);
    schedule.seek(4, 0.25);
    expect(posted.map((r) => r.type)).toEqual(["load"]);
    schedule.receive({ key: "a", type: "loaded", grid });
    expect(loaded()).toBe(1);
    expect(posted.at(-1)).toEqual({ type: "seek", key: "a", move: 4, fraction: 0.25 });
  });

  it("sends one seek at a time, skipping those overtaken", () => {
    const { schedule, posted, frames } = setup();
    schedule.load(load);
    schedule.receive({ key: "a", type: "loaded", grid });
    schedule.seek(1, 0);
    schedule.seek(2, 0);
    schedule.seek(3, 0);
    expect(posted.filter((r) => r.type === "seek")).toHaveLength(1);
    schedule.receive({ key: "a", type: "frame", start: 1, values: new Float32Array([-1]) });
    expect(frames).toEqual([[1, [-1]]]);
    expect(posted.at(-1)).toMatchObject({ move: 3 });
    expect(posted.filter((r) => r.type === "seek")).toHaveLength(2);
  });

  it("doesn't seek again to where it already is", () => {
    const { schedule, posted } = setup();
    schedule.load(load);
    schedule.receive({ key: "a", type: "loaded", grid });
    schedule.seek(0, 0);
    expect(posted.filter((r) => r.type === "seek")).toHaveLength(0);
  });

  it("drops responses to an earlier load", () => {
    const { schedule, frames, loaded } = setup();
    schedule.load(load);
    schedule.load({ ...load, key: "b" });
    schedule.receive({ key: "a", type: "loaded", grid });
    schedule.receive({ key: "a", type: "frame", start: 0, values: new Float32Array([1]) });
    expect(loaded()).toBe(0);
    expect(frames).toEqual([]);
  });

  it("drops a seek queued for the last path when loading another", () => {
    const { schedule, posted } = setup();
    schedule.load(load);
    schedule.receive({ key: "a", type: "loaded", grid });
    schedule.seek(5, 0);
    schedule.seek(9, 0);
    schedule.load({ ...load, key: "b" });
    schedule.receive({ key: "b", type: "loaded", grid });
    schedule.seek(2, 0);
    schedule.receive({ key: "b", type: "frame", start: 0, values: new Float32Array() });
    expect(posted.filter((r) => r.key === "b" && r.type === "seek")).toEqual([
      { type: "seek", key: "b", move: 2, fraction: 0 },
    ]);
  });

  it("reports errors and a stopped worker", () => {
    const { schedule, errors } = setup();
    schedule.load(load);
    schedule.receive({ key: "a", type: "error", error: "Bad" });
    schedule.fail("Stopped");
    expect(errors).toEqual(["Bad", "Stopped"]);
  });
});
