import { distance, GEOMETRY_TOLERANCE, type Point } from "@furrow/document";
import { describe, expect, it } from "vitest";
import { type BSpline, type SplineSegment, splineAt, splineToSegments } from "./spline";

function cubicAt(from: Point, segment: SplineSegment, t: number): Point {
  if (segment.kind === "line") {
    return [from[0] + (segment.to[0] - from[0]) * t, from[1] + (segment.to[1] - from[1]) * t];
  }
  const u = 1 - t;
  const w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t] as const;
  const points = [from, segment.c1, segment.c2, segment.to];
  return [0, 1].map((axis) =>
    points.reduce((sum, point, i) => sum + (w[i] as number) * (point[axis] as number), 0),
  ) as Point;
}

/** The largest distance from points on the converted segments to the spline itself. */
function maxDeviation(spline: BSpline): number {
  const converted = splineToSegments(spline);
  if (!converted) throw new Error("not converted");
  const samples: Point[] = [];
  let from = converted.start;
  for (const segment of converted.segments) {
    for (let i = 0; i <= 20; i++) samples.push(cubicAt(from, segment, i / 20));
    from = segment.to;
  }
  const { degree, knots, controlPoints } = spline;
  const first = knots[degree] as number;
  const last = knots[controlPoints.length] as number;
  const curve: Point[] = [];
  for (let i = 0; i <= 4000; i++) curve.push(splineAt(spline, first + ((last - first) * i) / 4000));
  return Math.max(
    ...samples.map((p) =>
      Math.min(...curve.slice(1).map((q, i) => segmentDistance(p, curve[i] as Point, q))),
    ),
  );
}

function segmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lengthSquared));
  return distance(p, [a[0] + t * dx, a[1] + t * dy]);
}

describe("splineToSegments", () => {
  it("keeps a clamped cubic Bézier as it is", () => {
    const result = splineToSegments({
      degree: 3,
      knots: [0, 0, 0, 0, 1, 1, 1, 1],
      controlPoints: [
        [0, 0],
        [1, 2],
        [3, 2],
        [4, 0],
      ],
    });
    expect(result).toEqual({
      start: [0, 0],
      segments: [{ kind: "cubic", c1: [1, 2], c2: [3, 2], to: [4, 0] }],
    });
  });

  it("turns a degree-1 spline into lines", () => {
    const result = splineToSegments({
      degree: 1,
      knots: [0, 0, 1, 2, 2],
      controlPoints: [
        [0, 0],
        [1, 0],
        [1, 1],
      ],
    });
    expect(result?.segments).toEqual([
      { kind: "line", to: [1, 0] },
      { kind: "line", to: [1, 1] },
    ]);
  });

  it("elevates a quadratic exactly", () => {
    const result = splineToSegments({
      degree: 2,
      knots: [0, 0, 0, 1, 1, 1],
      controlPoints: [
        [0, 0],
        [3, 3],
        [6, 0],
      ],
    });
    expect(result?.segments).toEqual([{ kind: "cubic", c1: [2, 2], c2: [4, 2], to: [6, 0] }]);
  });

  it.each([
    [
      "clamped with interior knots",
      {
        degree: 3,
        knots: [0, 0, 0, 0, 1, 2, 2, 3, 3, 3, 3],
        controlPoints: [
          [0, 0],
          [10, 20],
          [20, -10],
          [30, 15],
          [40, 0],
          [50, 25],
          [60, 0],
        ] as Point[],
      },
    ],
    [
      "unclamped, as periodic splines are written",
      {
        degree: 3,
        knots: [-3, -2, -1, 0, 1, 2, 3, 4, 5, 6],
        controlPoints: [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
          [0, 0],
          [10, 0],
        ] as Point[],
      },
    ],
    [
      "a quadratic with a knot of multiplicity 2",
      {
        degree: 2,
        knots: [0, 0, 0, 1, 1, 2, 2, 2],
        controlPoints: [
          [0, 0],
          [5, 10],
          [10, 0],
          [15, -10],
          [20, 0],
        ] as Point[],
      },
    ],
  ])("follows a %s spline exactly", (_, spline) => {
    const converted = splineToSegments(spline);
    const { degree, knots, controlPoints } = spline;
    // Each piece spans one knot interval of the domain, with the same parametrisation.
    const spans = [...new Set(knots.slice(degree, controlPoints.length + 1))];
    expect(converted?.segments).toHaveLength(spans.length - 1);
    let from = converted?.start as Point;
    converted?.segments.forEach((segment, i) => {
      const u0 = spans[i] as number;
      const u1 = spans[i + 1] as number;
      for (let j = 0; j <= 10; j++) {
        const t = j / 10;
        expect(
          distance(cubicAt(from, segment, t), splineAt(spline, u0 + (u1 - u0) * t)),
        ).toBeLessThan(1e-9);
      }
      from = segment.to;
    });
  });

  it("approximates a rational quarter circle within the geometry tolerance", () => {
    const spline: BSpline = {
      degree: 2,
      knots: [0, 0, 0, 1, 1, 1],
      controlPoints: [
        [100, 0],
        [100, 100],
        [0, 100],
      ],
      weights: [1, Math.SQRT1_2, 1],
    };
    const result = splineToSegments(spline);
    expect(result?.start).toEqual([100, 0]);
    expect(result?.segments.at(-1)?.to[0]).toBeCloseTo(0, 9);
    expect(result?.segments.at(-1)?.to[1]).toBeCloseTo(100, 9);
    expect(maxDeviation(spline)).toBeLessThanOrEqual(GEOMETRY_TOLERANCE);
    // On the circle, not just near the control polygon.
    for (const segment of result?.segments ?? []) {
      expect(Math.hypot(...segment.to)).toBeCloseTo(100, 6);
    }
  });

  it("approximates splines of degree above 3", () => {
    const spline: BSpline = {
      degree: 4,
      knots: [0, 0, 0, 0, 0, 1, 1, 1, 1, 1],
      controlPoints: [
        [0, 0],
        [10, 30],
        [20, -30],
        [30, 30],
        [40, 0],
      ],
    };
    expect(maxDeviation(spline)).toBeLessThanOrEqual(GEOMETRY_TOLERANCE);
  });

  // The test timeout is the check: the quadratic extraction took billions of steps here.
  it("converts long splines in linear time", () => {
    const count = 50_000;
    const controlPoints = Array.from({ length: count }, (_, i): Point => [i, i % 2]);
    const knots = [
      0,
      0,
      0,
      ...Array.from({ length: count - 2 }, (_, i) => i),
      count - 3,
      count - 3,
      count - 3,
    ];
    const result = splineToSegments({ degree: 3, knots, controlPoints });
    expect(result?.segments).toHaveLength(count - 3);
  });

  it("treats equal weights as non-rational", () => {
    const result = splineToSegments({
      degree: 3,
      knots: [0, 0, 0, 0, 1, 1, 1, 1],
      controlPoints: [
        [0, 0],
        [1, 2],
        [3, 2],
        [4, 0],
      ],
      weights: [2, 2, 2, 2],
    });
    expect(result?.segments).toHaveLength(1);
  });

  it.each([
    ["the wrong number of knots", { knots: [0, 0, 0, 1, 1, 1] }],
    ["decreasing knots", { knots: [0, 0, 0, 1, 0, 1, 1, 1] }],
    ["a non-positive weight", { weights: [1, 0, 1, 1] }],
    ["too few control points", { controlPoints: [[0, 0] as Point] }],
    ["an empty domain", { knots: [0, 0, 0, 0, 0, 0, 0, 0] }],
  ])("rejects %s", (_, change) => {
    const spline: BSpline = {
      degree: 3,
      knots: [0, 0, 0, 0, 1, 1, 1, 1],
      controlPoints: [
        [0, 0],
        [1, 2],
        [3, 2],
        [4, 0],
      ],
      ...change,
    };
    expect(splineToSegments(spline)).toBeNull();
  });
});
