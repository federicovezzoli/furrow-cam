import type { Path, Point, Shape } from "@furrow/document";
import { describe, expect, it } from "vitest";
import { closedPathsInside, pathAt, pathKey, pickablePaths } from "./pick";

const PART = "4f8a1c2e-6b3d-4e5f-9a7b-8c9d0e1f2a3b";
const OTHER = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";

function shape(id: string, ...paths: Path[]): Shape {
  return { id, name: "", layer: "", paths };
}

function polyline(points: Point[], closed: boolean): Path {
  const [start, ...rest] = points as [Point, ...Point[]];
  return { start, segments: rest.map((to) => ({ kind: "line", to })), closed };
}

function rectangle([x0, y0]: Point, [x1, y1]: Point): Path {
  return polyline(
    [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ],
    true,
  );
}

function circle(center: Point, radius: number): Path {
  const start: Point = [center[0] + radius, center[1]];
  return { start, segments: [{ kind: "arc", to: start, center, clockwise: false }], closed: true };
}

// One shape holding a whole part, as an OpenSCAD export does: an outline and two holes.
const part = shape(PART, rectangle([0, 0], [100, 60]), circle([20, 30], 5), circle([80, 30], 5));
const paths = pickablePaths([part]);

describe("pathKey", () => {
  it("tells paths apart", () => {
    expect(pathKey({ shapeId: PART, path: 1 })).toBe(pathKey({ shapeId: PART, path: 1 }));
    expect(pathKey({ shapeId: PART, path: 1 })).not.toBe(pathKey({ shapeId: PART, path: 2 }));
    expect(pathKey({ shapeId: PART, path: 1 })).not.toBe(pathKey({ shapeId: OTHER, path: 1 }));
  });
});

describe("pickablePaths", () => {
  it("flattens each path once, however often it is asked", () => {
    const [first] = pickablePaths([part]);
    const [again] = pickablePaths([{ ...part, id: OTHER }]);
    expect(again?.points).toBe(first?.points);
    expect(again?.shapeId).toBe(OTHER);
  });

  it("flattens every path of every shape, with its index, bounds and area", () => {
    const point = shape(OTHER, polyline([[150, 20]], false));
    const pickable = pickablePaths([part, point]);
    expect(pickable.map(({ shapeId, path }) => [shapeId, path])).toEqual([
      [PART, 0],
      [PART, 1],
      [PART, 2],
      [OTHER, 0],
    ]);
    expect(pickable[0]).toMatchObject({ closed: true, area: 6000, min: [0, 0], max: [100, 60] });
    // Flattened within the chord tolerance, so a little short of πr².
    expect(pickable[1]?.area).toBeCloseTo(Math.PI * 25, 0);
    expect(pickable[3]).toMatchObject({ closed: false, area: 0, min: [150, 20], max: [150, 20] });
  });
});

describe("pathAt", () => {
  it("picks the path whose line is within the radius", () => {
    expect(pathAt(paths, [50, 1], 2)).toEqual({ shapeId: PART, path: 0 });
    expect(pathAt(paths, [50, -1.5], 2)).toEqual({ shapeId: PART, path: 0 });
    expect(pathAt(paths, [26, 30], 2)).toEqual({ shapeId: PART, path: 1 });
    expect(pathAt(paths, [50, -3], 2)).toBeNull();
  });

  it("picks the nearest line when several are in reach", () => {
    const close = pickablePaths([part, shape(OTHER, rectangle([0, 61], [100, 80]))]);
    expect(pathAt(close, [50, 60.4], 1)).toEqual({ shapeId: PART, path: 0 });
    expect(pathAt(close, [50, 60.6], 1)).toEqual({ shapeId: OTHER, path: 0 });
  });

  it("picks the innermost closed path around the point, whatever its size", () => {
    expect(pathAt(paths, [20, 30], 1)).toEqual({ shapeId: PART, path: 1 });
    expect(pathAt(paths, [80, 31], 1)).toEqual({ shapeId: PART, path: 2 });
    expect(pathAt(paths, [50, 30], 1)).toEqual({ shapeId: PART, path: 0 });
    expect(pathAt(paths, [150, 30], 1)).toBeNull();
  });

  it("prefers a line in reach to a path around the point", () => {
    // Inside the hole, within reach of its own line.
    expect(pathAt(paths, [24.5, 30], 1)).toEqual({ shapeId: PART, path: 1 });
    // Inside the outline, within reach of the hole from outside it.
    expect(pathAt(paths, [25.5, 30], 1)).toEqual({ shapeId: PART, path: 1 });
    // Inside the hole, within reach of a line of another shape.
    const crossing = pickablePaths([
      part,
      shape(
        OTHER,
        polyline(
          [
            [0, 30],
            [40, 30],
          ],
          false,
        ),
      ),
    ]);
    expect(pathAt(crossing, [20, 30.5], 1)).toEqual({ shapeId: OTHER, path: 0 });
  });

  it("never picks an open path by its inside", () => {
    const open = pickablePaths([
      shape(
        OTHER,
        polyline(
          [
            [0, 0],
            [10, 0],
            [10, 10],
            [0, 10],
          ],
          false,
        ),
      ),
    ]);
    expect(pathAt(open, [5, 5], 1)).toBeNull();
    expect(pathAt(open, [5, 10.5], 1)).toEqual({ shapeId: OTHER, path: 0 });
  });

  it("picks single points within the radius", () => {
    const points = pickablePaths([
      shape(OTHER, polyline([[10, 10]], false), polyline([[20, 10]], false)),
    ]);
    expect(pathAt(points, [11, 10.5], 2)).toEqual({ shapeId: OTHER, path: 0 });
    expect(pathAt(points, [19, 10], 2)).toEqual({ shapeId: OTHER, path: 1 });
    expect(pathAt(points, [15, 10], 2)).toBeNull();
  });

  it("picks a single point by the arms of the cross it is drawn as", () => {
    const hole = pickablePaths([
      shape(PART, rectangle([0, 0], [100, 60]), polyline([[50, 30]], false)),
    ]);
    // On an arm 3 mm long, 2.5 mm from the point.
    expect(pathAt(hole, [52.5, 30.2], 0.5, { pointSize: 3 })).toEqual({ shapeId: PART, path: 1 });
    expect(pathAt(hole, [50.2, 27.5], 0.5, { pointSize: 3 })).toEqual({ shapeId: PART, path: 1 });
    // Without the cross, that click falls inside the outline.
    expect(pathAt(hole, [52.5, 30.2], 0.5)).toEqual({ shapeId: PART, path: 0 });
    // Past the arm's end, or between the arms.
    expect(pathAt(hole, [54, 30], 0.5, { pointSize: 3 })).toEqual({ shapeId: PART, path: 0 });
    expect(pathAt(hole, [52, 32], 0.5, { pointSize: 3 })).toEqual({ shapeId: PART, path: 0 });
  });

  it("keeps the earliest of paths as near", () => {
    const twice = pickablePaths([shape(PART, circle([0, 0], 5)), shape(OTHER, circle([0, 0], 5))]);
    expect(pathAt(twice, [5, 0], 1)).toEqual({ shapeId: PART, path: 0 });
    expect(pathAt(twice, [0, 0], 1)).toEqual({ shapeId: PART, path: 0 });
  });
});

describe("closedPathsInside", () => {
  const outline = { shapeId: PART, path: 0 };

  it("finds the closed paths inside the selected ones, in any shape", () => {
    const islands = pickablePaths([
      part,
      shape(
        OTHER,
        circle([50, 30], 3),
        // Open, crossing the outline, and outside it.
        polyline(
          [
            [40, 10],
            [60, 10],
          ],
          false,
        ),
        rectangle([90, 50], [110, 55]),
        rectangle([120, 0], [130, 10]),
      ),
    ]);
    expect(closedPathsInside(islands, [outline])).toEqual([
      { shapeId: PART, path: 1 },
      { shapeId: PART, path: 2 },
      { shapeId: OTHER, path: 0 },
    ]);
  });

  it("includes nested paths and paths touching the line", () => {
    const nested = pickablePaths([
      shape(PART, rectangle([0, 0], [100, 60]), circle([20, 30], 10), circle([20, 30], 4)),
      shape(OTHER, rectangle([0, 0], [10, 10])),
    ]);
    expect(closedPathsInside(nested, [outline])).toEqual([
      { shapeId: PART, path: 1 },
      { shapeId: PART, path: 2 },
      { shapeId: OTHER, path: 0 },
    ]);
  });

  it("reads the selection with the even-odd rule, leaving out parts in its holes", () => {
    // A washer, outer and inner circles selected, with a separate part in its
    // hole and a bump on the ring between them.
    const washer = pickablePaths([
      shape(PART, circle([0, 0], 50), circle([0, 0], 20)),
      shape(OTHER, rectangle([-5, -5], [5, 5]), circle([35, 0], 3)),
    ]);
    expect(
      closedPathsInside(washer, [
        { shapeId: PART, path: 0 },
        { shapeId: PART, path: 1 },
      ]),
    ).toEqual([{ shapeId: OTHER, path: 1 }]);
  });

  it("finds nothing inside open or unknown paths", () => {
    const open = pickablePaths([
      shape(
        PART,
        polyline(
          [
            [0, 0],
            [10, 0],
            [10, 10],
            [0, 10],
          ],
          false,
        ),
      ),
      shape(OTHER, circle([5, 5], 1)),
    ]);
    expect(closedPathsInside(open, [outline, { shapeId: OTHER, path: 7 }])).toEqual([]);
  });
});
