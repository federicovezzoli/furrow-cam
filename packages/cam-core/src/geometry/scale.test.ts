import { Shape } from "@furrow/document";
import { square } from "@furrow/document/fixtures";
import { describe, expect, it } from "vitest";
import { shapesBounds } from "./bounds";
import { scalePoint, scaleShapes } from "./scale";

describe("scalePoint", () => {
  it("scales about `from` and lands it on `to`, rounding float noise", () => {
    expect(scalePoint([10, 20], 2, [10, 20], [10, 20])).toEqual([10, 20]);
    expect(scalePoint([20, 20], 2, [10, 20], [10, 20])).toEqual([30, 20]);
    expect(scalePoint([20, 20], 0.5, [10, 20], [0, 0])).toEqual([5, 0]);
    expect(scalePoint([0.3, 0], 1 / 3, [0, 0], [0, 0])).toEqual([0.1, 0]);
  });
});

describe("scaleShapes", () => {
  const shape: Shape = {
    ...square,
    paths: [
      {
        start: [0, 0],
        segments: [
          { kind: "line", to: [10, 0] },
          { kind: "arc", to: [0, 10], center: [0, 0], clockwise: false },
          { kind: "cubic", c1: [-5, 10], c2: [-5, 0], to: [0, 0] },
        ],
        closed: true,
      },
    ],
  };

  it("scales every point, arc centres and cubic control points included, keeping arcs' direction", () => {
    expect(scaleShapes([shape], 2, [0, 0], [1, 1])).toEqual([
      {
        ...shape,
        paths: [
          {
            start: [1, 1],
            segments: [
              { kind: "line", to: [21, 1] },
              { kind: "arc", to: [1, 21], center: [1, 1], clockwise: false },
              { kind: "cubic", c1: [-9, 21], c2: [-9, 1], to: [1, 1] },
            ],
            closed: true,
          },
        ],
      },
    ]);
  });

  it("keeps the shapes valid and their proportions", () => {
    const [scaled] = scaleShapes([square], 1.7, [0, 0], [0, 0]);
    expect(Shape.parse(scaled)).toEqual(scaled);
    const before = shapesBounds([square]);
    const after = shapesBounds(scaleShapes([square], 1.7, [0, 0], [0, 0]));
    if (!before || !after) throw new Error("bounds");
    expect(after.max[0] / after.max[1]).toBeCloseTo(before.max[0] / before.max[1], 9);
  });
});
