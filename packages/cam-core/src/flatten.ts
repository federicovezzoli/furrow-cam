import { distance, type Path, type Point, pointsCoincide } from "@furrow/document";

/** Default chord tolerance in millimetres for flattening curves (ADR-0007). */
export const DEFAULT_CHORD_TOLERANCE = 0.01;

/** Largest angle one chord of an arc may span, so a full circle never collapses to a line. */
const MAX_ARC_STEP = Math.PI / 2;

/**
 * Flattens a path into a polyline whose chords stay within `tolerance` of the
 * original curves. Segment ends are kept exactly. A closed path ends back at
 * `start`; a path with no segments is the single point `[start]`.
 */
export function flattenPath(path: Path, tolerance = DEFAULT_CHORD_TOLERANCE): Point[] {
  if (!(tolerance > 0)) throw new RangeError("Chord tolerance must be positive");
  const points: Point[] = [path.start];
  let current = path.start;
  for (const segment of path.segments) {
    if (segment.kind === "arc") {
      flattenArc(points, current, segment.to, segment.center, segment.clockwise, tolerance);
    } else if (segment.kind === "cubic") {
      flattenCubic(points, current, segment.c1, segment.c2, segment.to, tolerance);
    }
    points.push(segment.to);
    current = segment.to;
  }
  if (path.closed && !pointsCoincide(current, path.start)) points.push(path.start);
  return points;
}

/** Pushes the inner points of an arc; the caller pushes `to`. */
function flattenArc(
  points: Point[],
  from: Point,
  to: Point,
  center: Point,
  clockwise: boolean,
  tolerance: number,
) {
  const radius = distance(center, from);
  const start = Math.atan2(from[1] - center[1], from[0] - center[0]);
  const end = Math.atan2(to[1] - center[1], to[0] - center[0]);
  const TAU = 2 * Math.PI;
  let sweep = pointsCoincide(from, to)
    ? TAU
    : (((clockwise ? start - end : end - start) % TAU) + TAU) % TAU;
  if (clockwise) sweep = -sweep;

  // A chord spanning angle θ deviates from the arc by r(1 − cos(θ/2)).
  const step =
    tolerance >= radius
      ? MAX_ARC_STEP
      : Math.min(2 * Math.acos(1 - tolerance / radius), MAX_ARC_STEP);
  const count = Math.max(1, Math.ceil(Math.abs(sweep) / step));
  for (let i = 1; i < count; i++) {
    const angle = start + (sweep * i) / count;
    points.push([center[0] + radius * Math.cos(angle), center[1] + radius * Math.sin(angle)]);
  }
}

/** Pushes the inner points of a cubic Bézier; the caller pushes `p3`. */
function flattenCubic(
  points: Point[],
  p0: Point,
  p1: Point,
  p2: Point,
  p3: Point,
  tolerance: number,
) {
  // Wang's formula: the fewest uniform steps that keep every chord within tolerance.
  const m = Math.max(
    Math.hypot(p0[0] - 2 * p1[0] + p2[0], p0[1] - 2 * p1[1] + p2[1]),
    Math.hypot(p1[0] - 2 * p2[0] + p3[0], p1[1] - 2 * p2[1] + p3[1]),
  );
  const count = Math.max(1, Math.ceil(Math.sqrt((0.75 * m) / tolerance)));
  for (let i = 1; i < count; i++) {
    const t = i / count;
    const u = 1 - t;
    const a = u * u * u;
    const b = 3 * u * u * t;
    const c = 3 * u * t * t;
    const d = t * t * t;
    points.push([
      a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
      a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1],
    ]);
  }
}
