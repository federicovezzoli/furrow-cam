import type { Path, Point, Shape } from "@furrow/document";
import { describe, expect, it } from "vitest";
import { pathBounds, shapesBounds } from "./bounds";
import { roundCoordinate } from "./round";

describe("pathBounds", () => {
  it("is the points of a polyline", () => {
    expect(
      pathBounds({
        start: [1, 2],
        segments: [
          { kind: "line", to: [-3, 5] },
          { kind: "line", to: [4, -1] },
        ],
        closed: false,
      }),
    ).toEqual({ min: [-3, -1], max: [4, 5] });
  });

  it("is a single point's own", () => {
    expect(pathBounds({ start: [7, 8], segments: [], closed: false })).toEqual({
      min: [7, 8],
      max: [7, 8],
    });
  });

  it("covers a full circle", () => {
    const circle: Path = {
      start: [15, 5],
      segments: [{ kind: "arc", to: [15, 5], center: [5, 5], clockwise: false }],
      closed: true,
    };
    expect(pathBounds(circle)).toEqual({ min: [-5, -5], max: [15, 15] });
  });

  it("covers only the quadrants an arc sweeps, in its direction", () => {
    // From (10, 0) to (0, 10) round the origin.
    const arc = (clockwise: boolean): Path => ({
      start: [10, 0],
      segments: [{ kind: "arc", to: [0, 10], center: [0, 0], clockwise }],
      closed: false,
    });
    expect(pathBounds(arc(false))).toEqual({ min: [0, 0], max: [10, 10] });
    expect(pathBounds(arc(true))).toEqual({ min: [-10, -10], max: [10, 10] });
  });

  it("covers where a cubic bulges past its ends", () => {
    // The curve peaks at t = 0.5: 0.375 × 10 + 0.375 × 10 = 7.5.
    expect(
      pathBounds({
        start: [0, 0],
        segments: [{ kind: "cubic", c1: [0, 10], c2: [10, 10], to: [10, 0] }],
        closed: false,
      }),
    ).toEqual({ min: [0, 0], max: [10, 7.5] });
  });

  it("covers both turning points of an S-shaped cubic", () => {
    // y = 3t(1 − t)(1 − 2t) turns at t = 1/2 ∓ √3/6, reaching ±√3/6.
    const box = pathBounds({
      start: [0, 0],
      segments: [{ kind: "cubic", c1: [0, 1], c2: [1, -1], to: [1, 0] }],
      closed: false,
    });
    expect(box.min[0]).toBe(0);
    expect(box.max[0]).toBe(1);
    expect(box.min[1]).toBeCloseTo(-Math.sqrt(3) / 6, 12);
    expect(box.max[1]).toBeCloseTo(Math.sqrt(3) / 6, 12);
  });

  /** A quadratic from `p0` through control `q` to `p2`, raised to a cubic the way SVG import does. */
  function raised(p0: Point, q: Point, p2: Point, round = (value: number) => value): Path {
    const control = (end: Point): Point => [
      round(end[0] + (2 / 3) * (q[0] - end[0])),
      round(end[1] + (2 / 3) * (q[1] - end[1])),
    ];
    return {
      start: p0,
      segments: [{ kind: "cubic", c1: control(p0), c2: control(p2), to: p2 }],
      closed: false,
    };
  }

  /** The quadratic's bounds, from its own extremes. */
  function quadraticBounds(p0: Point, q: Point, p2: Point) {
    const min: Point = [Math.min(p0[0], p2[0]), Math.min(p0[1], p2[1])];
    const max: Point = [Math.max(p0[0], p2[0]), Math.max(p0[1], p2[1])];
    for (const axis of [0, 1] as const) {
      const t = (p0[axis] - q[axis]) / (p0[axis] - 2 * q[axis] + p2[axis]);
      if (t > 0 && t < 1) {
        const value = (1 - t) ** 2 * p0[axis] + 2 * t * (1 - t) * q[axis] + t ** 2 * p2[axis];
        min[axis] = Math.min(min[axis], value);
        max[axis] = Math.max(max[axis], value);
      }
    }
    return { min, max };
  }

  function expectBox(actual: { min: Point; max: Point }, expected: { min: Point; max: Point }) {
    for (const axis of [0, 1]) {
      expect(actual.min[axis]).toBeCloseTo(expected.min[axis] as number, 9);
      expect(actual.max[axis]).toBeCloseTo(expected.max[axis] as number, 9);
    }
  }

  it("covers where a quadratic raised to a cubic bulges past its ends", () => {
    const quadratics: [Point, Point, Point][] = [
      [
        [0.3, 0.7],
        [5.1, 13.3],
        [9.7, 2.9],
      ],
      [
        [12.7, 3.1],
        [-4.3, 8.9],
        [10.1, 21.7],
      ],
      [
        [0.1, 0.2],
        [33.3, -17.7],
        [66.6, 0.3],
      ],
    ];
    for (const [p0, q, p2] of quadratics) {
      const expected = quadraticBounds(p0, q, p2);
      expectBox(pathBounds(raised(p0, q, p2)), expected);
      // Rounded to a nanometre, as imported coordinates are: a cubic only nearly quadratic.
      const rounded = pathBounds(raised(p0, q, p2, roundCoordinate));
      for (const axis of [0, 1]) {
        expect(rounded.min[axis]).toBeCloseTo(expected.min[axis] as number, 6);
        expect(rounded.max[axis]).toBeCloseTo(expected.max[axis] as number, 6);
      }
    }
  });
});

describe("shapesBounds", () => {
  const shape = (start: [number, number]): Shape => ({
    id: "00000000-0000-4000-8000-000000000000",
    name: "",
    layer: "0",
    paths: [{ start, segments: [], closed: false }],
  });

  it("joins every shape's paths, or is null without any", () => {
    expect(shapesBounds([shape([1, 9]), shape([-4, 2])])).toEqual({ min: [-4, 2], max: [1, 9] });
    expect(shapesBounds([])).toBeNull();
  });
});
