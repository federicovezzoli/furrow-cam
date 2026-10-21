import type { Point, Shape } from "@furrow/document";
import { roundCoordinate } from "./round";
import { mapPath } from "./translate";

/**
 * `point` scaled by `scale` about `from`, then moved so that `from` lands on
 * `to`, rounded like imported coordinates. With `to` equal to `from`, a
 * scale about that point.
 */
export function scalePoint([x, y]: Point, scale: number, from: Point, to: Point): Point {
  return [
    roundCoordinate(to[0] + (x - from[0]) * scale),
    roundCoordinate(to[1] + (y - from[1]) * scale),
  ];
}

/**
 * `shapes` scaled uniformly by `scale` about `from`, which lands on `to`
 * (`scalePoint`). Arcs keep their direction, their centre and radius scaling
 * with their points, and cubics their control points (ADR-0055).
 */
export function scaleShapes(shapes: Shape[], scale: number, from: Point, to: Point): Shape[] {
  const move = (point: Point) => scalePoint(point, scale, from, to);
  return shapes.map((shape) => ({
    ...shape,
    paths: shape.paths.map((path) => mapPath(path, move)),
  }));
}
