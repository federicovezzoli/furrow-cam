import { describe, expect, it } from "vitest";
import { circle, square } from "./fixtures";
import { Path, Shape } from "./geometry";

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
});
