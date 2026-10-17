import {
  distance,
  GEOMETRY_TOLERANCE,
  type Path,
  type Point,
  pointsCoincide,
} from "@furrow/document";
import { signedArea } from "./clipper";
import { flattenPath } from "./flatten";
import { projectOnLoop } from "./loop";

/** How far, in millimetres, a circle's diameter may be from the tool's for it to be drilled. */
export const DRILL_DIAMETER_TOLERANCE = 0.1;

/**
 * The centre of `path` if it is a circle in the sense drilling uses: a closed
 * path a circle fits (`isRound`), drawn as arcs, a polygon or Béziers. `null` for any other path. `flattened` is
 * the path from `flattenPath` at the default tolerance, if already at hand.
 */
export function circleCenter(path: Path, flattened?: Point[]): Point | null {
  if (!path.closed || path.segments.length === 0) return null;
  const round = roundness(path, flattened);
  return round && isRound(round) ? round.center : null;
}

/**
 * How far an outline may stray from a circle, as a share of its radius, when
 * that is more than `DRILL_DIAMETER_TOLERANCE` (#154): a large circle exported
 * as a coarse polygon (Inkscape's R12 DXF writes 24-gons) strays further
 * than a small one, in proportion to its size.
 */
export const ROUNDNESS_SHARE = 0.01;

/**
 * Whether a circle fits an outline: its nearest and farthest points from the
 * centre within `DRILL_DIAMETER_TOLERANCE` of each other, or within
 * `ROUNDNESS_SHARE` of its radius when that is more.
 */
export function isRound({ min, max }: { min: number; max: number }): boolean {
  return max - min <= Math.max(DRILL_DIAMETER_TOLERANCE, ROUNDNESS_SHARE * max) + 2e-9;
}

/**
 * The centre of a closed path and the nearest and farthest its outline comes
 * to it: exact for a circle of arcs, otherwise from the path flattened, around
 * the centroid of its area. `null` for a path enclosing no area. `flattened`
 * saves flattening the path again.
 */
export function roundness(
  path: Path,
  flattened?: Point[],
): { center: Point; min: number; max: number } | null {
  const circle = arcCircle(path);
  if (circle) return { center: circle.center, min: circle.radius, max: circle.radius };
  const loop = flattened ?? flattenPath(path);
  const center = centroid(loop);
  if (!center) return null;
  const max = Math.max(...loop.map((point) => distance(center, point)));
  return { center, min: projectOnLoop(loop, center).distance, max };
}

/** The circle `path` traces, if it is a closed path of arcs around one centre with one radius. */
function arcCircle(path: Path): { center: Point; radius: number } | null {
  const [first] = path.segments;
  if (first?.kind !== "arc") return null;
  const center = first.center;
  const radius = distance(center, path.start);
  for (const segment of path.segments) {
    if (segment.kind !== "arc" || !pointsCoincide(segment.center, center)) return null;
    if (Math.abs(distance(center, segment.to) - radius) > GEOMETRY_TOLERANCE) return null;
  }
  const end = path.segments.at(-1)?.to ?? path.start;
  return pointsCoincide(end, path.start) ? { center, radius } : null;
}

/** The centroid of the area a closed polyline (ending on its first point) encloses, if any. */
function centroid(loop: Point[]): Point | null {
  const area = signedArea(loop.slice(0, -1));
  if (Math.abs(area) <= GEOMETRY_TOLERANCE ** 2) return null;
  let x = 0;
  let y = 0;
  for (let i = 1; i < loop.length; i++) {
    const [ax, ay] = loop[i - 1] as Point;
    const [bx, by] = loop[i] as Point;
    const cross = ax * by - bx * ay;
    x += (ax + bx) * cross;
    y += (ay + by) * cross;
  }
  return [x / (6 * area), y / (6 * area)];
}
