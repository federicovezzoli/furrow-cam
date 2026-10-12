import { distance, type Path, type Point, type Shape } from "@furrow/document";
import { flattenPath } from "./flatten";
import { type Containment, containmentIn, signedArea } from "./geometry";
import { projectOnLoop } from "./tabs";

/** One path of a shape: `path` is its index in the shape's `paths`. */
export type PathRef = { shapeId: string; path: number };

/** A key for a path, to compare or collect path references. */
export function pathKey({ shapeId, path }: PathRef): string {
  return `${shapeId}:${path}`;
}

/** What hit-testing needs of a path, worked out once per path. */
type FlatPath = {
  points: Point[];
  closed: boolean;
  /** Absolute area of a closed path, 0 for an open one. */
  area: number;
  min: Point;
  max: Point;
  /** Where a point lies relative to the path, read as a ring. */
  contains: (point: Point) => Containment;
};

/** A path flattened for hit-testing, with its bounding box. */
export type PickablePath = PathRef & FlatPath;

/**
 * Flattened paths by identity. Immer keeps unchanged shapes and their paths
 * as the same objects (ADR-0010), so only new paths are flattened again.
 */
const flatPaths = new WeakMap<Path, FlatPath>();

function flatPath(path: Path): FlatPath {
  let flat = flatPaths.get(path);
  if (!flat) {
    const points = flattenPath(path);
    let min: Point = [Infinity, Infinity];
    let max: Point = [-Infinity, -Infinity];
    for (const [x, y] of points) {
      min = [Math.min(min[0], x), Math.min(min[1], y)];
      max = [Math.max(max[0], x), Math.max(max[1], y)];
    }
    flat = {
      points,
      closed: path.closed,
      area: path.closed ? Math.abs(signedArea(points)) : 0,
      min,
      max,
      contains: containmentIn(points),
    };
    flatPaths.set(path, flat);
  }
  return flat;
}

/** Every path of `shapes`, flattened for `pathAt` and `closedPathsInside`. */
export function pickablePaths(shapes: readonly Shape[]): PickablePath[] {
  return shapes.flatMap((shape) =>
    shape.paths.map((path, index) => ({ shapeId: shape.id, path: index, ...flatPath(path) })),
  );
}

export type PathAtOptions = {
  /**
   * Arm length of the cross a single-point path (a drill location) is drawn
   * as: the cross is picked, not only its centre.
   */
  pointSize?: number;
};

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
  { pointSize = 0 }: PathAtOptions = {},
): PathRef | null {
  let nearest: PickablePath | null = null;
  let nearestDistance = Infinity;
  let innermost: PickablePath | null = null;
  for (const path of paths) {
    const single = path.points.length === 1;
    if (withinBox(path, point, radius + (single ? pointSize : 0))) {
      const d = single
        ? distanceToCross(path.points[0] as Point, pointSize, point)
        : projectOnLoop(path.points, point).distance;
      if (d <= radius && d < nearestDistance) {
        nearest = path;
        nearestDistance = d;
      }
    }
    if (
      !nearest &&
      path.closed &&
      withinBox(path, point, 0) &&
      (!innermost || path.area < innermost.area) &&
      path.contains(point) !== "outside"
    ) {
      innermost = path;
    }
  }
  const hit = nearest ?? innermost;
  return hit && { shapeId: hit.shapeId, path: hit.path };
}

/** Distance from `point` to a cross of arms `size` long around `center`. */
function distanceToCross(center: Point, size: number, point: Point): number {
  const dx = Math.abs(point[0] - center[0]);
  const dy = Math.abs(point[1] - center[1]);
  return Math.min(
    distance([Math.max(dx - size, 0), dy], [0, 0]),
    distance([dx, Math.max(dy - size, 0)], [0, 0]),
  );
}

/**
 * The closed paths of `paths` inside the area the closed paths `outer` refers
 * to enclose, read with the even-odd rule a pocket uses (#54): those inside
 * an odd number of them, every point inside each or on its line. That is a
 * pocket's islands: not a part sitting in a hole of the selection, which the
 * pocket would clear instead. Paths in `outer` are left out. In the order of
 * `paths`.
 */
export function closedPathsInside(
  paths: readonly PickablePath[],
  outer: readonly PathRef[],
): PathRef[] {
  const outerKeys = new Set(outer.map(pathKey));
  const rings = paths.filter((path) => path.closed && outerKeys.has(pathKey(path)));
  return paths
    .filter((candidate) => {
      if (!candidate.closed || outerKeys.has(pathKey(candidate))) return false;
      const around = rings.filter(
        (ring) =>
          candidate.min[0] >= ring.min[0] &&
          candidate.min[1] >= ring.min[1] &&
          candidate.max[0] <= ring.max[0] &&
          candidate.max[1] <= ring.max[1] &&
          candidate.points.every((point) => ring.contains(point) !== "outside"),
      );
      return around.length % 2 === 1;
    })
    .map(({ shapeId, path }) => ({ shapeId, path }));
}

function withinBox({ min, max }: FlatPath, [x, y]: Point, margin: number): boolean {
  return (
    x >= min[0] - margin && x <= max[0] + margin && y >= min[1] - margin && y <= max[1] + margin
  );
}
