import type { Path, Point, Shape } from "@furrow/document";
import { DRAWING_ID } from "@furrow/document/fixtures";
import { describe, expect, it } from "vitest";
import { circleCenter } from "../geometry/circle";
import {
  holeSnapTargets,
  nearestHoleSnap,
  nearestSnapTarget,
  type SnapTarget,
  snapEdges,
  snapTargets,
} from "./snap";

const stock = { width: 600, height: 400 };

function shape(...paths: Path[]): Shape {
  return {
    id: "4f8a1c2e-6b3d-4e5f-9a7b-8c9d0e1f2a3b",
    name: "",
    layer: "",
    drawingId: DRAWING_ID,
    paths,
  };
}

function polyline(points: Point[], closed: boolean): Path {
  const [start, ...rest] = points as [Point, ...Point[]];
  return { start, segments: rest.map((to) => ({ kind: "line", to })), closed };
}

function circle(center: Point, radius: number): Path {
  const start: Point = [center[0] + radius, center[1]];
  return { start, segments: [{ kind: "arc", to: start, center, clockwise: false }], closed: true };
}

/** A regular polygon with `sides` vertices on the circle of `radius` around `center`. */
function polygon(center: Point, radius: number, sides: number): Path {
  const points = Array.from({ length: sides }, (_, i): Point => {
    const angle = (2 * Math.PI * i) / sides;
    return [center[0] + radius * Math.cos(angle), center[1] + radius * Math.sin(angle)];
  });
  return polyline(points, true);
}

const kinds = (targets: SnapTarget[], kind: SnapTarget["kind"]) =>
  targets.filter((target) => target.kind === kind).map(({ point }) => point);

describe("snapTargets", () => {
  it("has the 9 stock anchors, following the stock's size", () => {
    const anchors = snapTargets(stock, []);
    expect(anchors).toHaveLength(9);
    expect(anchors).toContainEqual({ kind: "stock_anchor", anchor: "center", point: [300, 200] });
    expect(anchors).toContainEqual({
      kind: "stock_anchor",
      anchor: "top_right",
      point: [600, 400],
    });
  });

  it("has every vertex of a shape and its bounding box", () => {
    const targets = snapTargets(stock, [
      shape(
        polyline(
          [
            [10, 10],
            [50, 10],
            [50, 30],
          ],
          true,
        ),
      ),
    ]);
    expect(kinds(targets, "vertex")).toEqual([
      [10, 10],
      [50, 10],
      [50, 30],
    ]);
    expect(kinds(targets, "bounds_corner")).toEqual([
      [10, 10],
      [50, 10],
      [50, 30],
      [10, 30],
    ]);
    expect(kinds(targets, "bounds_center")).toEqual([[30, 20]]);
  });

  it("takes the bounding box across all of a shape's paths and around its curves", () => {
    const half: Path = {
      start: [0, 0],
      segments: [{ kind: "arc", to: [20, 0], center: [10, 0], clockwise: true }],
      closed: false,
    };
    const targets = snapTargets(stock, [shape(half, polyline([[100, -5]], false))]);
    const [corner] = kinds(targets, "bounds_corner");
    expect(corner?.[0]).toBeCloseTo(0);
    expect(corner?.[1]).toBeCloseTo(-5);
    const [, , opposite] = kinds(targets, "bounds_corner");
    expect(opposite?.[0]).toBeCloseTo(100);
    // Exact, like the box drawings are aligned by: the arc's top, not a flattened vertex.
    expect(opposite?.[1]).toBe(10);
    expect(kinds(targets, "arc_center")).toEqual([[10, 0]]);
    // A single-point path (a drill location) is a vertex.
    expect(kinds(targets, "vertex")).toContainEqual([100, -5]);
  });

  it("has the centre of circles drawn as arcs or as polygons, not of their arcs", () => {
    const targets = snapTargets(stock, [
      shape(circle([100, 100], 5)),
      shape(polygon([200, 100], 10, 36)),
    ]);
    const centers = kinds(targets, "circle_center");
    expect(centers).toHaveLength(2);
    expect(centers[0]).toEqual([100, 100]);
    expect(centers[1]?.[0]).toBeCloseTo(200);
    expect(centers[1]?.[1]).toBeCloseTo(100);
    expect(kinds(targets, "arc_center")).toEqual([]);
  });

  it("has no circle centre for a coarse polygon or an open path", () => {
    const targets = snapTargets(stock, [
      shape(polygon([100, 100], 10, 6)),
      shape(
        polyline(
          [
            [0, 0],
            [10, 0],
            [10, 10],
          ],
          false,
        ),
      ),
    ]);
    expect(kinds(targets, "circle_center")).toEqual([]);
  });
});

describe("circleCenter", () => {
  it("is what drilling takes as a circle", () => {
    expect(circleCenter(circle([5, 5], 3))).toEqual([5, 5]);
    expect(circleCenter(polygon([0, 0], 3, 6))).toBeNull();
    expect(circleCenter(polyline([[1, 2]], false))).toBeNull();
  });
});

describe("nearestSnapTarget", () => {
  const targets = snapTargets(stock, [
    shape(
      polyline(
        [
          [0, 0],
          [40, 0],
          [40, 20],
          [0, 20],
        ],
        true,
      ),
    ),
    shape(circle([100, 100], 5)),
  ]);

  it("is the nearest target within the radius", () => {
    expect(nearestSnapTarget(targets, [39, 19], 3)).toEqual({ kind: "vertex", point: [40, 20] });
    expect(nearestSnapTarget(targets, [101, 99], 3)).toEqual({
      kind: "circle_center",
      point: [100, 100],
    });
  });

  it("is null when nothing is within the radius", () => {
    expect(nearestSnapTarget(targets, [70, 70], 3)).toBeNull();
    expect(nearestSnapTarget([], [0, 0], 3)).toBeNull();
  });

  it("keeps the earlier of coinciding targets against a farther one in between", () => {
    const first: SnapTarget = { kind: "vertex", point: [0, 0] };
    const coinciding: SnapTarget = { kind: "bounds_corner", point: [0.0009, 0] };
    const between: SnapTarget = { kind: "bounds_center", point: [0.0008, 0.04] };
    expect(nearestSnapTarget([first, coinciding, between], [10, 0], 20)).toBe(first);
  });

  it("prefers the earlier of coinciding targets: a stock anchor over a vertex over a box corner", () => {
    expect(nearestSnapTarget(targets, [1, 1], 3)).toEqual({
      kind: "stock_anchor",
      anchor: "bottom_left",
      point: [0, 0],
    });
    expect(nearestSnapTarget(targets, [40, 0.5], 3)?.kind).toBe("vertex");
    expect(nearestSnapTarget(targets, [20, 10], 3)?.kind).toBe("bounds_center");
  });
});

describe("holeSnapTargets", () => {
  it("adds the middle of every line, closing lines included, after the zero's targets", () => {
    const shapes = [
      shape(
        polyline(
          [
            [0, 0],
            [10, 0],
            [10, 20],
          ],
          true,
        ),
      ),
    ];
    const targets = holeSnapTargets(stock, shapes);
    expect(targets.slice(0, -3)).toEqual(snapTargets(stock, shapes));
    expect(kinds(targets, "midpoint")).toEqual([
      [5, 0],
      [10, 10],
      [5, 10],
    ]);
  });

  it("takes the middle of an arc along it, either way round, and of a full circle", () => {
    const arc = (clockwise: boolean): Path => ({
      start: [10, 0],
      segments: [{ kind: "arc", to: [0, 10], center: [0, 0], clockwise }],
      closed: false,
    });
    const [ccw] = kinds(holeSnapTargets(stock, [shape(arc(false))]), "midpoint");
    const [cw] = kinds(holeSnapTargets(stock, [shape(arc(true))]), "midpoint");
    const [full] = kinds(holeSnapTargets(stock, [shape(circle([0, 0], 10))]), "midpoint");
    const h = 10 * Math.SQRT1_2;
    expect(ccw?.[0]).toBeCloseTo(h);
    expect(ccw?.[1]).toBeCloseTo(h);
    expect(cw?.[0]).toBeCloseTo(-h);
    expect(cw?.[1]).toBeCloseTo(-h);
    expect(full?.[0]).toBeCloseTo(-10);
    expect(full?.[1]).toBeCloseTo(0);
  });

  it("takes a Bézier's point at half its parameter", () => {
    const curve: Path = {
      start: [0, 0],
      segments: [{ kind: "cubic", c1: [0, 8], c2: [8, 8], to: [8, 0] }],
      closed: false,
    };
    expect(kinds(holeSnapTargets(stock, [shape(curve)]), "midpoint")).toEqual([[4, 6]]);
  });
});

describe("nearestHoleSnap", () => {
  const shapes = [
    shape(
      polyline(
        [
          [0, 0],
          [100, 0],
          [100, 100],
        ],
        false,
      ),
    ),
  ];
  const targets = holeSnapTargets(stock, shapes);
  const edges = snapEdges(shapes);

  it("snaps to a target in range before the edge", () => {
    expect(nearestHoleSnap(targets, edges, [48, 1], 3)).toEqual({
      kind: "midpoint",
      point: [50, 0],
    });
  });

  it("snaps onto the nearest edge when no target is in range", () => {
    expect(nearestHoleSnap(targets, edges, [30, 2], 3)).toEqual({ kind: "edge", point: [30, 0] });
  });

  it("finds nothing out of range", () => {
    expect(nearestHoleSnap(targets, edges, [30, 5], 3)).toBeNull();
  });

  it("has no edges for single-point paths", () => {
    expect(snapEdges([shape({ start: [1, 1], segments: [], closed: false })])).toEqual([]);
  });
});
