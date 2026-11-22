import type { ToolpathMove } from "@furrow/cam-core";
import { DEFAULT_SPIN_UP_DELAY, type Machine } from "@furrow/document";
import { machine } from "@furrow/document/fixtures";
import { describe, expect, it } from "vitest";
import { estimateTime, formatDuration } from "./estimate";

// maxFeedXY 10000, maxFeedZ 2500 mm/min; no dwell, so only moves count.
const fast: Machine = { ...machine, spinUpDelay: 0 };
const start: ToolpathMove = { kind: "rapid", to: [0, 0, 5] };
const time = (moves: ToolpathMove[], on: Machine | null = fast) =>
  estimateTime({ moves, warnings: [] }, on);

describe("estimateTime", () => {
  it("takes each feed move's length at its feed, not the move getting there", () => {
    expect(time([start, { kind: "feed", to: [100, 0, 5], feedRate: 1000 }])).toBeCloseTo(6);
  });

  it("slows feeds to the machine's XY and Z maximums", () => {
    // 1000 mm at 10000 mm/min, not 20000.
    expect(time([start, { kind: "feed", to: [1000, 0, 5], feedRate: 20000 }])).toBeCloseTo(6);
    // 25 mm down at 2500 mm/min, not 5000.
    expect(time([start, { kind: "feed", to: [0, 0, -20], feedRate: 5000 }])).toBeCloseTo(0.6);
  });

  it("runs rapids at the XY or the Z maximum, whichever limits", () => {
    expect(time([start, { kind: "rapid", to: [1000, 0, 5] }])).toBeCloseTo(6);
    expect(time([start, { kind: "rapid", to: [0, 0, -20] }])).toBeCloseTo(0.6);
  });

  it("counts the clearing moves and a spin-up for each tool", () => {
    const moves: ToolpathMove[] = [start, { kind: "feed", to: [100, 0, 5], feedRate: 1000 }];
    const toolpath = { moves, clearing: moves, warnings: [] };
    expect(estimateTime(toolpath, fast)).toBeCloseTo(12);
    expect(estimateTime(toolpath, { ...machine, spinUpDelay: 3 })).toBeCloseTo(18);
    expect(estimateTime({ moves: [], warnings: [] }, machine)).toBe(0);
  });

  it("counts only feed moves without a machine", () => {
    const moves: ToolpathMove[] = [
      start,
      { kind: "rapid", to: [1000, 0, 5] },
      { kind: "feed", to: [1100, 0, 5], feedRate: 1000 },
    ];
    expect(time(moves, null)).toBeCloseTo(6 + DEFAULT_SPIN_UP_DELAY);
  });
});

describe("estimateTime with accelerations", () => {
  const accelerating: Machine = { ...fast, accelerationXY: 200, accelerationZ: 80 };
  const feed = (x: number, y: number, z = 5): ToolpathMove => ({
    kind: "feed",
    to: [x, y, z],
    feedRate: 6000,
  });

  it("takes a long straight move close to its length at its feed", () => {
    // 100 mm/s reached after 25 mm, in 0.5 s, and lost the same way: 10 s plus 0.5.
    expect(time([start, feed(1000, 0)], accelerating)).toBeCloseTo(10.5);
    // Split into collinear pieces, it never slows down in between.
    expect(time([start, feed(250, 0), feed(500, 0), feed(1000, 0)], accelerating)).toBeCloseTo(
      10.5,
    );
  });

  it("takes many short zigzag moves much slower than their length at their feed", () => {
    const moves: ToolpathMove[] = [start];
    for (let i = 1; i <= 1000; i++) moves.push(feed(i * 0.1, i % 2 === 0 ? 0 : 0.1));
    const lowerBound = time(moves);
    expect(time(moves, accelerating)).toBeGreaterThan(5 * lowerBound);
  });

  it("plans only so many moves ahead, so short moves in a line stay slow", () => {
    const moves: ToolpathMove[] = [start];
    for (let i = 1; i <= 1000; i++) moves.push(feed(i * 0.1, 0));
    // Stopping within 16 moves of 0.1 mm caps the speed at √(2 · 200 · 1.6) ≈ 25 mm/s, not 100.
    expect(time(moves, accelerating)).toBeGreaterThan(100 / 25.3);
  });

  it("takes a corner at the acceleration of the axes its direction changes on", () => {
    const corner = (accelerationZ: number) =>
      time([start, feed(10, 0, 6), feed(20, 0, 5)], { ...accelerating, accelerationZ });
    // Mostly X moves, but the corner turns in Z only.
    expect(corner(80)).toBeGreaterThan(corner(8000) + 0.01);
  });

  it("slows nearly to a stop at a square corner", () => {
    const straight = time([start, feed(100, 0), feed(200, 0)], accelerating);
    const corner = time([start, feed(100, 0), feed(100, 100)], accelerating);
    // Straight on: 2 s at 100 mm/s, plus 0.5 s to start and stop. The corner
    // nearly stops, close to two moves from rest to rest: 3 s.
    expect(straight).toBeCloseTo(2.5);
    expect(corner).toBeGreaterThan(straight + 0.4);
    expect(corner).toBeLessThan(3);
  });

  it("speeds up Z-only moves at the Z acceleration", () => {
    // 10 mm at 80 mm/s²: a triangle peaking at √800 mm/s after 5 mm.
    const down: ToolpathMove = { kind: "feed", to: [0, 0, -5], feedRate: 6000 };
    expect(time([start, down], accelerating)).toBeCloseTo((2 * Math.sqrt(800)) / 80);
  });
});

describe("formatDuration", () => {
  it("writes seconds under a minute, else minutes and hours", () => {
    expect(formatDuration(44.6)).toBe("45 s");
    expect(formatDuration(725)).toBe("12 min");
    expect(formatDuration(3900)).toBe("1 h 5 min");
  });
});
