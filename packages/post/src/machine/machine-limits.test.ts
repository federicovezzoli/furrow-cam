import { lowRider, machine } from "@furrow/document/fixtures";
import { describe, expect, it } from "vitest";
import { limitFeed, spindleSpeed } from "./machine-limits";

describe("limitFeed", () => {
  it("keeps the feed without a machine or within its maximums", () => {
    expect(limitFeed([0, 0, 0], [100, 0, 0], 50000, null)).toBe(50000);
    expect(limitFeed([0, 0, 0], [100, 0, -1], 1500, machine)).toBe(1500);
  });

  it("lowers a move along XY or Z to that axis' maximum", () => {
    expect(limitFeed([0, 0, 0], [30, 40, 0], 12000, machine)).toBe(10000);
    expect(limitFeed([0, 0, 0], [0, 0, -5], 3000, machine)).toBe(2500);
  });

  it("lowers a ramp so neither component exceeds its maximum", () => {
    // Length 5: the Z component is 4/5 of the feed, at most 2500.
    expect(limitFeed([0, 0, 0], [3, 0, -4], 5000, machine)).toBe(3125);
  });

  it("rounds the lowered feed down", () => {
    // 2500 * √10 / 3 = 2635.2313…
    expect(limitFeed([0, 0, 0], [1, 0, -3], 5000, machine)).toBe(2635.231);
  });
});

describe("spindleSpeed", () => {
  it("keeps the speed without a machine or within its range", () => {
    expect(spindleSpeed(50000, null)).toEqual({ value: 50000, clamped: false });
    expect(spindleSpeed(18000, machine)).toEqual({ value: 18000, clamped: false });
  });

  it("clamps the speed to the machine's range", () => {
    expect(spindleSpeed(5000, machine)).toEqual({ value: 10000, clamped: true });
    expect(spindleSpeed(40000, machine)).toEqual({ value: 30000, clamped: true });
  });

  it("gives no speed for a manual spindle", () => {
    expect(spindleSpeed(18000, lowRider)).toEqual({ value: null, clamped: false });
  });
});
