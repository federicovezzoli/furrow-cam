import type { Path, Shape } from "@furrow/document";
import { describe, expect, it } from "vitest";
import { selectionTargets, shapePaths, targetsLabel } from "./path-selection";

const point = (x: number): Path => ({ start: [x, 0], segments: [], closed: false });
const a: Shape = { id: "a", name: "A", layer: "", paths: [point(0), point(1), point(2)] };
const b: Shape = { id: "b", name: "B", layer: "", paths: [point(3)] };

describe("shapePaths", () => {
  it("lists every path of the shape", () => {
    expect(shapePaths(a)).toEqual([
      { shapeId: "a", path: 0 },
      { shapeId: "a", path: 1 },
      { shapeId: "a", path: 2 },
    ]);
  });
});

describe("selectionTargets", () => {
  it("groups paths by shape, in document order, whole when all are selected", () => {
    expect(
      selectionTargets(
        [a, b],
        [
          { shapeId: "b", path: 0 },
          { shapeId: "a", path: 2 },
          { shapeId: "a", path: 0 },
        ],
      ),
    ).toEqual([
      { shapeId: "a", paths: [0, 2] },
      { shapeId: "b", paths: null },
    ]);
    expect(selectionTargets([a], shapePaths(a))).toEqual([{ shapeId: "a", paths: null }]);
  });

  it("skips shapes and paths that are gone", () => {
    expect(
      selectionTargets(
        [a],
        [
          { shapeId: "a", path: 5 },
          { shapeId: "c", path: 0 },
        ],
      ),
    ).toEqual([]);
  });
});

describe("targetsLabel", () => {
  it("counts whole shapes and the paths of the others", () => {
    expect(targetsLabel([{ shapeId: "a", paths: null }])).toBe("1 selected shape");
    expect(
      targetsLabel([
        { shapeId: "a", paths: null },
        { shapeId: "b", paths: null },
      ]),
    ).toBe("2 selected shapes");
    expect(targetsLabel([{ shapeId: "a", paths: [1] }])).toBe("1 selected path");
    expect(targetsLabel([{ shapeId: "a", paths: [0, 2] }])).toBe("2 selected paths");
    expect(
      targetsLabel([
        { shapeId: "a", paths: [0, 2] },
        { shapeId: "b", paths: null },
      ]),
    ).toBe("1 selected shape and 2 paths");
  });
});
