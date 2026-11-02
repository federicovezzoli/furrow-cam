import { type CornerOvercuts, distance, type Point } from "@furrow/document";

/**
 * How far past `maxAngle`, in degrees, a corner still gets an overcut: well
 * above the noise Clipper's rounding to 1e-4 mm puts on the angle of a
 * corner between real edges, so a drawn 90° corner qualifies at 90°.
 */
export const CORNER_ANGLE_TOLERANCE = 0.1;

/**
 * A corner overcut (#428) on a ring: at `vertex`, the tool centre goes out to
 * `tip` along the bisector and back. `corner` is the drawn corner, and
 * `excludedBy` the indices of the excluded points nearest to it.
 */
export type Overcut = {
  ring: number;
  vertex: number;
  tip: Point;
  corner: Point;
  excludedBy: number[];
};

/**
 * The overcuts of `rings`, each `offset` off its drawn paths with the waste
 * on its left or right: one at each vertex where the waste side's angle θ is
 * at most `maxAngle`, out along the bisector to `offset` from the drawn
 * corner, which is `offset / sin(θ/2)` from the vertex. A tool whose radius
 * is the offset just touches the corner there; one an allowance smaller
 * stops that short. Each excluded point goes to the overcut whose corner is
 * nearest to it.
 */
export function findOvercuts(
  rings: { ring: Point[]; wasteLeft: boolean }[],
  offset: number,
  { maxAngle, excluded }: CornerOvercuts,
): Overcut[] {
  const limit = ((maxAngle + CORNER_ANGLE_TOLERANCE) * Math.PI) / 180;
  const overcuts: Overcut[] = [];
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
      if (angle > limit) return;
      const bisector = unit([vertex[0] + a[0] + b[0], vertex[1] + a[1] + b[1]], vertex);
      if (!bisector) return;
      const reach = offset / Math.sin(angle / 2);
      const along = (length: number): Point => [
        vertex[0] - bisector[0] * length,
        vertex[1] - bisector[1] * length,
      ];
      overcuts.push({
        ring: index,
        vertex: i,
        tip: along(reach - offset),
        corner: along(reach),
        excludedBy: [],
      });
    });
  });
  excluded.forEach((point, index) => {
    let nearest: Overcut | undefined;
    for (const overcut of overcuts) {
      if (!nearest || distance(point, overcut.corner) < distance(point, nearest.corner)) {
        nearest = overcut;
      }
    }
    nearest?.excludedBy.push(index);
  });
  return overcuts;
}

/** `ring` going out to the tip of each of `overcuts` on it, not excluded, and back. */
export function withOvercuts(ring: Point[], overcuts: Overcut[]): Point[] {
  const at = new Map(
    overcuts.filter(({ excludedBy }) => excludedBy.length === 0).map((o) => [o.vertex, o.tip]),
  );
  return ring.flatMap((point, i) => {
    const tip = at.get(i);
    return tip ? [point, tip, point] : [point];
  });
}

/** The unit vector from `from` to `to`, or `null` if they coincide. */
function unit(to: Point, from: Point): Point | null {
  const length = distance(from, to);
  return length > 1e-9 ? [(to[0] - from[0]) / length, (to[1] - from[1]) / length] : null;
}
