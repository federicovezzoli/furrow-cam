import { distance, type Point } from "@furrow/document";

/** The nearest point of a loop: where it is, how far along and away, and the loop's direction there. */
export type Projection = { point: Point; at: number; distance: number; tangent: Point };

/** The point of `loop` nearest to `point`. */
export function projectOnLoop(loop: Point[], point: Point): Projection {
  let best: Projection | null = null;
  let travelled = 0;
  for (let i = 1; i < loop.length; i++) {
    const a = loop[i - 1] as Point;
    const b = loop[i] as Point;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const lengthSquared = dx * dx + dy * dy;
    const t =
      lengthSquared > 0
        ? Math.max(
            0,
            Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / lengthSquared),
          )
        : 0;
    const candidate: Point = [a[0] + t * dx, a[1] + t * dy];
    const d = distance(point, candidate);
    const length = Math.sqrt(lengthSquared);
    if (length > 0 && (!best || d < best.distance)) {
      const tangent: Point = [dx / length, dy / length];
      best = { point: candidate, at: travelled + t * length, distance: d, tangent };
    }
    travelled += length;
  }
  return (
    best ?? {
      point: loop[0] as Point,
      at: 0,
      distance: distance(point, loop[0] as Point),
      tangent: [1, 0],
    }
  );
}
