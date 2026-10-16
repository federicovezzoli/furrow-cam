import type { Point } from "@furrow/document";
import { describe, expect, it } from "vitest";
import { arcToCubics, parsePathData, type RawSegment } from "./path-data";

function cubicAt(from: Point, segment: RawSegment, t: number): Point {
  if (segment.kind === "line") throw new Error("Expected a cubic");
  const u = 1 - t;
  const [a, b, c, d] = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
  return [
    a * from[0] + b * segment.c1[0] + c * segment.c2[0] + d * segment.to[0],
    a * from[1] + b * segment.c1[1] + c * segment.c2[1] + d * segment.to[1],
  ];
}

function expectPoint(actual: Point, expected: Point) {
  expect(actual[0]).toBeCloseTo(expected[0], 9);
  expect(actual[1]).toBeCloseTo(expected[1], 9);
}

describe("parsePathData", () => {
  it("reads absolute and relative lines, with implicit linetos after a moveto", () => {
    const { subpaths, valid } = parsePathData("M10 10 20 10 l0 10 H0 v-5 h5 V0 z");
    expect(valid).toBe(true);
    expect(subpaths).toEqual([
      {
        start: [10, 10],
        segments: [
          { kind: "line", to: [20, 10] },
          { kind: "line", to: [20, 20] },
          { kind: "line", to: [0, 20] },
          { kind: "line", to: [0, 15] },
          { kind: "line", to: [5, 15] },
          { kind: "line", to: [5, 0] },
        ],
        closed: true,
      },
    ]);
  });

  it("reads compact numbers: signs, leading dots and exponents as separators", () => {
    const { subpaths } = parsePathData("M0-1.5.5.5L1e1,2E-1");
    expect(subpaths[0]?.start).toEqual([0, -1.5]);
    expect(subpaths[0]?.segments.map((s) => s.to)).toEqual([
      [0.5, 0.5],
      [10, 0.2],
    ]);
  });

  it("starts a new subpath where the last one closed", () => {
    const { subpaths } = parsePathData("m10 10 h10 v10 z l-5 -5");
    expect(subpaths).toHaveLength(2);
    expect(subpaths[1]).toEqual({
      start: [10, 10],
      segments: [{ kind: "line", to: [5, 5] }],
      closed: false,
    });
  });

  it("reflects the previous control point for S and T", () => {
    const { subpaths } = parsePathData("M0 0 C0 10 10 10 10 0 S20 -10 20 0 Q25 5 30 0 T40 0");
    const [, s, q, t] = subpaths[0]?.segments ?? [];
    expect(s).toEqual({ kind: "cubic", c1: [10, -10], c2: [20, -10], to: [20, 0] });
    // A quadratic as a cubic: control points two thirds of the way to the quadratic one.
    if (q?.kind !== "cubic" || t?.kind !== "cubic") throw new Error("Expected cubics");
    expectPoint(q.c1, [20 + 10 / 3, 10 / 3]);
    expectPoint(q.c2, [30 - 10 / 3, 10 / 3]);
    expectPoint(t.c1, [30 + 10 / 3, -10 / 3]);
  });

  it("treats S and T without a previous curve as having their control point at the start", () => {
    const { subpaths } = parsePathData("M0 0 S10 10 20 0");
    expect(subpaths[0]?.segments[0]).toEqual({
      kind: "cubic",
      c1: [0, 0],
      c2: [10, 10],
      to: [20, 0],
    });
  });

  it("reads arc flags without separators", () => {
    const { subpaths, valid } = parsePathData("M0 0a5 5 0 1010 0");
    expect(valid).toBe(true);
    expect(subpaths[0]?.segments.at(-1)?.to).toEqual([10, 0]);
  });

  it("keeps what came before an error, as SVG renders it", () => {
    const { subpaths, valid } = parsePathData("M0 0 L10 0 L5 oops");
    expect(valid).toBe(false);
    expect(subpaths[0]?.segments).toEqual([{ kind: "line", to: [10, 0] }]);
  });

  it("rejects data that doesn't start with a moveto", () => {
    expect(parsePathData("L10 10")).toEqual({ subpaths: [], valid: false });
  });
});

describe("arcToCubics", () => {
  it("draws a half circle in the sweep direction, ending exactly on the end point", () => {
    const from: Point = [10, 0];
    const segments = arcToCubics(from, 10, 10, 0, false, true, [-10, 0]);
    expect(segments).toHaveLength(2);
    expect(segments.at(-1)?.to).toEqual([-10, 0]);
    // Positive sweep from (10, 0) passes through (0, 10).
    expect(segments[0]?.to[0]).toBeCloseTo(0, 9);
    expect(segments[0]?.to[1]).toBeCloseTo(10, 9);
    // Every point stays within 0.03% of the radius.
    let start = from;
    for (const segment of segments) {
      for (const t of [0.25, 0.5, 0.75]) {
        expect(Math.hypot(...cubicAt(start, segment, t))).toBeCloseTo(10, 2);
      }
      start = segment.to;
    }
  });

  it("scales radii up when they can't reach the end point", () => {
    const segments = arcToCubics([0, 0], 1, 1, 0, false, false, [20, 0]);
    // A half circle of radius 10, clockwise from (0, 0): over the top.
    expect(segments).toHaveLength(2);
    expectPoint(segments[0]?.to ?? [0, 0], [10, 10]);
  });

  it("takes the large arc when asked", () => {
    const small = arcToCubics([0, 0], 10, 10, 0, false, true, [10, 10]);
    const large = arcToCubics([0, 0], 10, 10, 0, true, true, [10, 10]);
    expect(small).toHaveLength(1);
    expect(large).toHaveLength(3);
  });

  it("rotates the ellipse", () => {
    const [first] = arcToCubics([0, 0], 20, 10, 90, false, true, [0, 40]);
    // A rotated half ellipse: its major axis is vertical, so it reaches 10 sideways.
    expect(Math.abs(first?.to[0] ?? 0)).toBeCloseTo(10, 9);
  });

  it("is a line when a radius is zero and nothing when the ends coincide", () => {
    expect(arcToCubics([0, 0], 0, 5, 0, false, true, [10, 0])).toEqual([
      { kind: "line", to: [10, 0] },
    ]);
    expect(arcToCubics([1, 1], 5, 5, 0, false, true, [1, 1])).toEqual([]);
  });
});
