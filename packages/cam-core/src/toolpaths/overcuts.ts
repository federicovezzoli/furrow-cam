import {
  distance,
  GEOMETRY_TOLERANCE,
  type Point,
  pointsCoincide,
  type Segment,
  type Shape,
} from "@furrow/document";
import { DEFAULT_CHORD_TOLERANCE } from "../geometry/flatten";
import type { Span } from "./tabs";

/**
 * How far past `maxAngle`, in degrees, a corner still gets an overcut, and
 * how close to 180° a join is smooth, not a corner: well above the float
 * noise on the directions of drawn segments.
 */
const CORNER_ANGLE_TOLERANCE = 0.1;

/**
 * A corner overcut (#428) at vertex `vertex` of ring `ring`: the tool centre
 * goes out to `tip` along the bisector and back. `corner` is the drawn
 * corner, and `excludedBy` the indices of the excluded points that leave it
 * out.
 */
export type Overcut = {
  ring: number;
  vertex: number;
  tip: Point;
  corner: Point;
  excludedBy: number[];
};

/**
 * Where the segments of the closed paths of `shapes` meet at an angle of at
 * most `maxAngle` degrees: the drawn corners that may get an overcut. A
 * smooth join, like a line tangent to an arc, is no corner.
 */
export function drawnCorners(shapes: Shape[], maxAngle: number): Point[] {
  const corners: Point[] = [];
  for (const shape of shapes) {
    for (const path of shape.paths) {
      if (!path.closed || path.segments.length === 0) continue;
      const segments = [...path.segments];
      if (!pointsCoincide((segments.at(-1) as Segment).to, path.start)) {
        segments.push({ kind: "line", to: path.start });
      }
      // Each segment's end, and the directions it leaves its start and arrives there with.
      const joins: { end: Point; leaving: Point; arriving: Point }[] = [];
      let from = path.start;
      for (const segment of segments) {
        const directions = segmentDirections(from, segment);
        if (directions) joins.push({ end: segment.to, ...directions });
        from = segment.to;
      }
      joins.forEach(({ end, arriving }, i) => {
        const { leaving } = joins[(i + 1) % joins.length] as (typeof joins)[number];
        const cos = arriving[0] * leaving[0] + arriving[1] * leaving[1];
        const angle = 180 - (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
        if (angle <= maxAngle + CORNER_ANGLE_TOLERANCE && angle < 180 - CORNER_ANGLE_TOLERANCE) {
          corners.push(end);
        }
      });
    }
  }
  return corners;
}

/**
 * The overcuts of `rings`, each `offset` off its drawn paths with the waste
 * on its left or right: one at each vertex where the waste side's angle θ is
 * under 180° and the drawn corner, `offset / sin(θ/2)` from the vertex along
 * the bisector, is one of the `corners` (`drawnCorners`) within the chord
 * `tolerance`. The overcut goes out to `offset` from the drawn corner: a
 * tool whose radius is the offset just touches it there, and one an
 * allowance smaller stops that short.
 */
export function findOvercuts(
  rings: { ring: Point[]; wasteLeft: boolean }[],
  offset: number,
  corners: Point[],
  tolerance = DEFAULT_CHORD_TOLERANCE,
): Overcut[] {
  const within = tolerance + GEOMETRY_TOLERANCE;
  const overcuts: Overcut[] = [];
  if (corners.length === 0) return overcuts;
  rings.forEach(({ ring, wasteLeft }, index) => {
    ring.forEach((vertex, i) => {
      const previous = ring[(i + ring.length - 1) % ring.length] as Point;
      const next = ring[(i + 1) % ring.length] as Point;
      const a = unit(previous, vertex);
      const b = unit(next, vertex);
      if (!a || !b) return;
      // Turning towards the waste side makes its angle the one under 180°.
      const turn =
        (vertex[0] - previous[0]) * (next[1] - vertex[1]) -
        (vertex[1] - previous[1]) * (next[0] - vertex[0]);
      if (turn > 0 !== wasteLeft) return;
      const angle = Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1])));
      const bisector = unit([vertex[0] + a[0] + b[0], vertex[1] + a[1] + b[1]], vertex);
      const reach = offset / Math.sin(angle / 2);
      // Nearly straight on there is nothing to overcut, and folded back no corner to reach.
      if (!bisector || !Number.isFinite(reach) || reach - offset <= GEOMETRY_TOLERANCE) return;
      const along = (length: number): Point => [
        vertex[0] - bisector[0] * length,
        vertex[1] - bisector[1] * length,
      ];
      const corner = along(reach);
      if (!corners.some((drawn) => distance(drawn, corner) <= within)) return;
      overcuts.push({ ring: index, vertex: i, tip: along(reach - offset), corner, excludedBy: [] });
    });
  });
  return overcuts;
}

/**
 * `overcuts` with each of the `excluded` points leaving out one whose corner
 * it is on, within the chord `tolerance`: one still cut first, so each of
 * the overcuts at a corner two contours share can be left out, then the
 * nearest. A point on no corner leaves out nothing.
 */
export function excludeOvercuts(
  overcuts: Overcut[],
  excluded: Point[],
  tolerance = DEFAULT_CHORD_TOLERANCE,
): Overcut[] {
  const within = tolerance + GEOMETRY_TOLERANCE;
  const result = overcuts.map((overcut) => ({ ...overcut, excludedBy: [] as number[] }));
  excluded.forEach((point, index) => {
    let best: Overcut | undefined;
    let bestDistance = within;
    for (const overcut of result) {
      const d = distance(point, overcut.corner);
      if (d > within) continue;
      const cut = overcut.excludedBy.length === 0;
      const bestCut = best?.excludedBy.length === 0;
      if (!best || (cut && !bestCut) || (cut === bestCut && d < bestDistance)) {
        best = overcut;
        bestDistance = d;
      }
    }
    best?.excludedBy.push(index);
  });
  return result;
}

/**
 * `ring` going out to the tip of each of `overcuts` on it, not excluded, and
 * back, with `tabs` moved along to match: an overcut on a tab's end is cut
 * outside it. One at the start comes at the end of the lap, so the ring
 * still starts there.
 */
export function withOvercuts(
  ring: Point[],
  tabs: Span[],
  overcuts: Overcut[],
): { ring: Point[]; tabs: Span[] } {
  const at = new Map(
    overcuts.filter(({ excludedBy }) => excludedBy.length === 0).map((o) => [o.vertex, o.tip]),
  );
  const result: Point[] = [];
  // How far along the ring each overcut goes out, and how much it adds.
  const added: [number, number][] = [];
  let travelled = 0;
  ring.forEach((point, i) => {
    if (i > 0) travelled += distance(ring[i - 1] as Point, point);
    result.push(point);
    const tip = at.get(i);
    if (tip && i > 0) {
      result.push(tip, point);
      added.push([travelled, 2 * distance(point, tip)]);
    }
  });
  const first = at.get(0);
  if (first) result.push(ring[0] as Point, first);
  const moved = (s: number, onIt: boolean) =>
    added.reduce((sum, [d, length]) => (d < s || (onIt && d === s) ? sum + length : sum), s);
  return { ring: result, tabs: tabs.map(([a, b]) => [moved(a, true), moved(b, false)]) };
}

/** The directions `segment` leaves `from` and arrives at its end with, or `null` if it has no length. */
function segmentDirections(
  from: Point,
  segment: Segment,
): { leaving: Point; arriving: Point } | null {
  if (segment.kind === "arc") {
    // Square to the radius, turning with the arc; a full circle has a start but no corner.
    const { center, clockwise, to } = segment;
    const tangent = ([x, y]: Point): Point | null => {
      const radial = unit([x, y], center);
      return radial && (clockwise ? [radial[1], -radial[0]] : [-radial[1], radial[0]]);
    };
    const leaving = tangent(from);
    const arriving = tangent(to);
    return leaving && arriving ? { leaving, arriving } : null;
  }
  const controls = segment.kind === "cubic" ? [segment.c1, segment.c2] : [];
  const points = [from, ...controls, segment.to];
  // A control point on its end point leaves the direction to the next one.
  const leaving = points.slice(1).reduce<Point | null>((d, p) => d ?? unit(p, from), null);
  const arriving = points
    .slice(0, -1)
    .reverse()
    .reduce<Point | null>((d, p) => d ?? unit(segment.to, p), null);
  return leaving && arriving ? { leaving, arriving } : null;
}

/** The unit vector from `from` to `to`, or `null` if they coincide. */
function unit(to: Point, from: Point): Point | null {
  const length = distance(from, to);
  return length > 1e-9 ? [(to[0] - from[0]) / length, (to[1] - from[1]) / length] : null;
}
