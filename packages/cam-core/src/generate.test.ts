import type { Path, Shape } from "@furrow/document";
import { describe, expect, it } from "vitest";
import { targetedShapes } from "./generate";

const A = "4f8a1c2e-6b3d-4e5f-9a7b-8c9d0e1f2a3b";
const B = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";

const point = (x: number): Path => ({ start: [x, 0], segments: [], closed: false });
const a: Shape = { id: A, name: "A", layer: "", paths: [point(0), point(1), point(2)] };
const b: Shape = { id: B, name: "B", layer: "", paths: [point(10)] };
const shapes = new Map([
  [A, a],
  [B, b],
]);

describe("targetedShapes", () => {
  it("keeps whole shapes whole, in the targets' order", () => {
    expect(
      targetedShapes(shapes, [
        { shapeId: B, paths: null },
        { shapeId: A, paths: null },
      ]),
    ).toEqual([b, a]);
  });

  it("keeps only the targeted paths of a shape", () => {
    expect(targetedShapes(shapes, [{ shapeId: A, paths: [0, 2] }])).toEqual([
      { ...a, paths: [point(0), point(2)] },
    ]);
  });

  it("skips missing shapes and paths", () => {
    const missing = "11111111-2222-4333-8444-555555555555";
    expect(
      targetedShapes(shapes, [
        { shapeId: missing, paths: null },
        { shapeId: B, paths: [3] },
        { shapeId: A, paths: [1, 5] },
      ]),
    ).toEqual([{ ...a, paths: [point(1)] }]);
  });
});
