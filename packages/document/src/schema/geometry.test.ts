import { describe, expect, it } from "vitest";
import { circle, square } from "./fixtures";
import { GEOMETRY_TOLERANCE, Path, pointsCoincide, Shape } from "./geometry";

describe("Shape", () => {
  it("accepts lines, arcs and cubics", () => {
    expect(Shape.parse(square)).toEqual(square);
    expect(Shape.parse(circle)).toEqual(circle);
  });

  it("accepts a point as a path with no segments", () => {
    const point = { start: [10, 20], segments: [], closed: false };
    expect(Path.parse(point)).toEqual(point);
  });

  it("rejects a closed path with no segments", () => {
    expect(Path.safeParse({ start: [0, 0], segments: [], closed: true }).success).toBe(false);
  });

  it("rejects malformed shapes", () => {
    expect(Shape.safeParse({ ...square, id: "square" }).success).toBe(false);
    expect(Shape.safeParse({ ...square, paths: [] }).success).toBe(false);
    const badPoint = { start: [0], segments: [], closed: false };
    expect(Shape.safeParse({ ...square, paths: [badPoint] }).success).toBe(false);
    const ellipse = { kind: "ellipse", to: [1, 1] };
    const path = { start: [0, 0], segments: [ellipse], closed: false };
    expect(Shape.safeParse({ ...square, paths: [path] }).success).toBe(false);
  });

  it("rejects unknown keys", () => {
    expect(Shape.safeParse({ ...square, colour: "red" }).success).toBe(false);
  });
});

describe("Path", () => {
  const arc = (to: [number, number], center: [number, number]) => ({
    start: [10, 0],
    segments: [{ kind: "arc", to, center, clockwise: false }],
    closed: false,
  });

  it("accepts a full circle whose end is only nearly at its start", () => {
    expect(Path.safeParse({ ...arc([10 + 1e-9, 0], [0, 0]), closed: true }).success).toBe(true);
  });

  it("rejects arcs whose end is not on the circle, or with zero radius", () => {
    expect(Path.safeParse(arc([0, 10], [0, 0])).success).toBe(true);
    expect(Path.safeParse(arc([0, 15], [0, 0])).success).toBe(false);
    expect(Path.safeParse(arc([20, 0], [10, 0])).success).toBe(false);
  });

  it("rejects zero-length segments", () => {
    const line = { start: [0, 0], segments: [{ kind: "line", to: [0, 0] }], closed: false };
    expect(Path.safeParse(line).success).toBe(false);
    const cubic = {
      start: [0, 0],
      segments: [{ kind: "cubic", c1: [0, 0], c2: [0, 0], to: [0, 0] }],
      closed: false,
    };
    expect(Path.safeParse(cubic).success).toBe(false);
  });

  it("rejects a closed path that is a single line", () => {
    const path = { start: [0, 0], segments: [{ kind: "line", to: [10, 0] }], closed: true };
    expect(Path.safeParse(path).success).toBe(false);
    expect(Path.safeParse({ ...path, closed: false }).success).toBe(true);
  });
});

describe("pointsCoincide", () => {
  it("compares within the geometry tolerance", () => {
    expect(pointsCoincide([0, 0], [GEOMETRY_TOLERANCE / 2, 0])).toBe(true);
    expect(pointsCoincide([0, 0], [GEOMETRY_TOLERANCE * 2, 0])).toBe(false);
  });
});
