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

describe("formatDuration", () => {
  it("writes seconds under a minute, else minutes and hours", () => {
    expect(formatDuration(44.6)).toBe("45 s");
    expect(formatDuration(725)).toBe("12 min");
    expect(formatDuration(3900)).toBe("1 h 5 min");
  });
});
