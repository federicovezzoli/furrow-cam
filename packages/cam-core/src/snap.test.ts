import type { Path, Point, Shape } from "@furrow/document";
import { describe, expect, it } from "vitest";
import { circleCenter } from "./drill";
import { nearestSnapTarget, type SnapTarget, snapTargets } from "./snap";

const stock = { width: 600, height: 400 };

function shape(...paths: Path[]): Shape {
  return { id: "4f8a1c2e-6b3d-4e5f-9a7b-8c9d0e1f2a3b", name: "", layer: "", paths };
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
    expect(opposite?.[1]).toBeCloseTo(10, 2);
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
