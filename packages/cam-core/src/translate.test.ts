import type { Shape } from "@furrow/document";
import { describe, expect, it } from "vitest";
import { translatePath, translatePoint, translateShape, translateShapes } from "./translate";

describe("translatePoint", () => {
  it("rounds away float noise", () => {
    expect(translatePoint([0.1, 0.2], [300, -0.1])).toEqual([300.1, 0.1]);
    expect(translatePoint(translatePoint([0.1, 0.2], [300, 200]), [-300, -200])).toEqual([
      0.1, 0.2,
    ]);
  });
});

describe("translatePath", () => {
  it("moves every point of every kind of segment", () => {
    expect(
      translatePath(
        {
          start: [0, 0],
          segments: [
            { kind: "line", to: [10, 0] },
            { kind: "arc", to: [0, 10], center: [0, 0], clockwise: false },
            { kind: "cubic", c1: [-5, 10], c2: [-5, 0], to: [0, 0] },
          ],
          closed: true,
        },
        [1, 2],
      ),
    ).toEqual({
      start: [1, 2],
      segments: [
        { kind: "line", to: [11, 2] },
        { kind: "arc", to: [1, 12], center: [1, 2], clockwise: false },
        { kind: "cubic", c1: [-4, 12], c2: [-4, 2], to: [1, 2] },
      ],
      closed: true,
    });
  });
});

describe("translateShape", () => {
  it("keeps everything but the paths", () => {
    const shape: Shape = {
      id: "00000000-0000-4000-8000-000000000000",
      name: "hole",
      layer: "0",
      source: "part.dxf",
      paths: [{ start: [5, 5], segments: [], closed: false }],
    };
    expect(translateShape(shape, [-5, 5])).toEqual({
      ...shape,
      paths: [{ start: [0, 10], segments: [], closed: false }],
    });
  });
});

describe("translateShapes", () => {
  it("returns the same array when nothing moves", () => {
    const shapes: Shape[] = [];
    expect(translateShapes(shapes, [0, 0])).toBe(shapes);
    expect(translateShapes(shapes, [1, 0])).not.toBe(shapes);
  });
});
