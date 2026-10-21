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
  return mapShapes(shapes, (point) => scalePoint(point, scale, from, to));
}

/** `shapes` with `move` applied to every point, as `mapPath` does. */
export function mapShapes(
  shapes: Shape[],
  move: (point: Point) => Point,
  mirrored = false,
): Shape[] {
  return shapes.map((shape) => ({
    ...shape,
    paths: shape.paths.map((path) => mapPath(path, move, mirrored)),
  }));
}

/** `point` turned `degrees` counter-clockwise about `about`, rounded like imported coordinates. */
export function rotatePoint([x, y]: Point, degrees: number, [cx, cy]: Point): Point {
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = x - cx;
  const dy = y - cy;
  return [roundCoordinate(cx + dx * cos - dy * sin), roundCoordinate(cy + dx * sin + dy * cos)];
}

/**
 * `point` mirrored across the line through `about` along the other axis:
 * `"x"` flips left and right, `"y"` up and down. Mirroring shapes reverses
 * arcs' direction (`mapShapes` with `mirrored`).
 */
export function mirrorPoint([x, y]: Point, axis: "x" | "y", [cx, cy]: Point): Point {
  return axis === "x" ? [roundCoordinate(2 * cx - x), y] : [x, roundCoordinate(2 * cy - y)];
}
