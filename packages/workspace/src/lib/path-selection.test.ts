import type { Path, Shape } from "@furrow/document";
import { DRAWING_ID } from "@furrow/document/fixtures";
import { describe, expect, it } from "vitest";
import { selectedDrawingId, selectionCounts, selectionTargets } from "./path-selection";

const point = (x: number): Path => ({ start: [x, 0], segments: [], closed: false });
const a: Shape = {
  id: "a",
  name: "A",
  layer: "",
  drawingId: DRAWING_ID,
  paths: [point(0), point(1), point(2)],
};
const b: Shape = { id: "b", name: "B", layer: "", drawingId: DRAWING_ID, paths: [point(3)] };

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
    const allOfA = a.paths.map((_, path) => ({ shapeId: "a", path }));
    expect(selectionTargets([a], allOfA)).toEqual([{ shapeId: "a", paths: null }]);
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

describe("selectionCounts", () => {
  it("counts whole shapes and the paths of the others", () => {
    expect(selectionCounts([{ shapeId: "a", paths: null }])).toEqual({ shapes: 1, paths: 0 });
    expect(
      selectionCounts([
        { shapeId: "a", paths: [0, 2] },
        { shapeId: "b", paths: null },
      ]),
    ).toEqual({ shapes: 1, paths: 2 });
  });
});

describe("selectedDrawingId", () => {
  const c: Shape = { ...b, id: "c", drawingId: "other" };

  it("is the drawing every selected path belongs to", () => {
    expect(
      selectedDrawingId(
        [a, b, c],
        [
          { shapeId: "a", path: 1 },
          { shapeId: "b", path: 0 },
        ],
      ),
    ).toBe(DRAWING_ID);
    expect(selectedDrawingId([a, b, c], [{ shapeId: "c", path: 0 }])).toBe("other");
  });

  it("is null for no selection, or paths of several drawings", () => {
    expect(selectedDrawingId([a, b, c], [])).toBeNull();
    expect(
      selectedDrawingId(
        [a, b, c],
        [
          { shapeId: "a", path: 0 },
          { shapeId: "c", path: 0 },
        ],
      ),
    ).toBeNull();
  });
});
