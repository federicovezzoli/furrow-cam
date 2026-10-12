import type { Point, Shape } from "@furrow/document";
import { flattenPath } from "./flatten";
import { containment, containmentIn, signedArea } from "./geometry";
import { projectOnLoop } from "./tabs";

/** One path of a shape: `path` is its index in the shape's `paths`. */
export type PathRef = { shapeId: string; path: number };

/** A path flattened for hit-testing, with its bounding box. */
export type PickablePath = PathRef & {
  points: Point[];
  closed: boolean;
  /** Absolute area of a closed path, 0 for an open one. */
  area: number;
  min: Point;
  max: Point;
};

/** Every path of `shapes`, flattened for `pathAt`; done once per geometry, not per pointer move. */
export function pickablePaths(shapes: readonly Shape[]): PickablePath[] {
  return shapes.flatMap((shape) =>
    shape.paths.map((path, index) => {
      const points = flattenPath(path);
      let min: Point = [Infinity, Infinity];
      let max: Point = [-Infinity, -Infinity];
      for (const [x, y] of points) {
        min = [Math.min(min[0], x), Math.min(min[1], y)];
        max = [Math.max(max[0], x), Math.max(max[1], y)];
      }
      return {
        shapeId: shape.id,
        path: index,
        points,
        closed: path.closed,
        area: path.closed ? Math.abs(signedArea(points)) : 0,
        min,
        max,
      };
    }),
  );
}

/**
 * The path at `point` (ADR-0008: our own geometry, not raycasting): the one
 * whose line is nearest, if within `radius`; otherwise the innermost closed
 * path containing `point`, whatever its size (#54); otherwise `null`. Of paths
 * as near, or as small, the earliest wins.
 */
export function pathAt(
  paths: readonly PickablePath[],
  point: Point,
  radius: number,
): PathRef | null {
  let nearest: PickablePath | null = null;
  let nearestDistance = Infinity;
  let innermost: PickablePath | null = null;
  for (const path of paths) {
    const inBox = withinBox(path, point, 0);
    if (withinBox(path, point, radius)) {
      const d = projectOnLoop(path.points, point).distance;
      if (d <= radius && d < nearestDistance) {
        nearest = path;
        nearestDistance = d;
      }
    }
    if (
      !nearest &&
      inBox &&
      path.closed &&
      (!innermost || path.area < innermost.area) &&
      containment(point, path.points) !== "outside"
    ) {
      innermost = path;
    }
  }
  const hit = nearest ?? innermost;
  return hit && { shapeId: hit.shapeId, path: hit.path };
}

/**
 * The closed paths of `paths` that lie inside one of the closed paths `outer`
 * refers to (#54), for leaving islands in a pocket: every point of the
 * flattened path is inside that path or on its line. Paths in `outer` are
 * left out; nested paths (a pupil in an eye) are included, as the even-odd
 * rule the pocket uses keeps them apart. In the order of `paths`.
 */
export function closedPathsInside(
  paths: readonly PickablePath[],
  outer: readonly PathRef[],
): PathRef[] {
  const key = ({ shapeId, path }: PathRef) => `${shapeId}:${path}`;
  const outerKeys = new Set(outer.map(key));
  const rings = paths
    .filter((path) => path.closed && outerKeys.has(key(path)))
    .map((path) => ({ path, contains: containmentIn(path.points) }));
  return paths
    .filter(
      (candidate) =>
        candidate.closed &&
        !outerKeys.has(key(candidate)) &&
        rings.some(
          ({ path, contains }) =>
            candidate.min[0] >= path.min[0] &&
            candidate.min[1] >= path.min[1] &&
            candidate.max[0] <= path.max[0] &&
            candidate.max[1] <= path.max[1] &&
            candidate.points.every((point) => contains(point) !== "outside"),
        ),
    )
    .map(({ shapeId, path }) => ({ shapeId, path }));
}

function withinBox({ min, max }: PickablePath, [x, y]: Point, margin: number): boolean {
  return (
    x >= min[0] - margin && x <= max[0] + margin && y >= min[1] - margin && y <= max[1] + margin
  );
}
