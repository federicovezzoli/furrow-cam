import type { Point, Shape, TextPlacement, TextSettings } from "@furrow/document";
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

/**
 * Where a point of a text item's layout lies in the stock (ADR-0059): flipped
 * left to right if `mirrored`, turned `rotation` degrees counter-clockwise
 * about the text's origin, then moved to `position`, rounded like imported
 * coordinates.
 */
export function textFrame({ position, rotation, mirrored }: TextPlacement) {
  const radians = (rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return ([x, y]: Point): Point => {
    const flipped = mirrored ? -x : x;
    return [
      roundCoordinate(position[0] + flipped * cos - y * sin),
      roundCoordinate(position[1] + flipped * sin + y * cos),
    ];
  };
}

/** Length of the axes `mapText` probes a move along, long enough that rounding doesn't show. */
const PROBE = 1000;

/**
 * Text item `text`'s settings once `move`, which keeps shapes' proportions
 * (`mapPath`), has rewritten its outlines (ADR-0059): its origin moves, a turn
 * adds to its rotation, a mirror flips it and a scale multiplies its height
 * and letter spacing, its lengths (its line spacing follows the height).
 */
export function mapText(text: TextSettings, move: (point: Point) => Point): TextSettings {
  // The text's own axes in the stock, after the move.
  const frame = textFrame(text.placement);
  const [ox, oy] = move(frame([0, 0]));
  const [xx, xy] = move(frame([PROBE, 0]));
  const [yx, yy] = move(frame([0, PROBE]));
  const [ux, uy, vx, vy] = [xx - ox, xy - oy, yx - ox, yy - oy];
  // The height comes from the y axis alone, so a move that stretches one axis would lose the outlines.
  if (Math.abs(Math.hypot(ux, uy) - Math.hypot(vx, vy)) > PROBE * 1e-6) {
    throw new Error("mapText needs a move that keeps shapes' proportions");
  }
  const turned = (Math.atan2(vy, vx) * 180) / Math.PI - 90;
  const scale = Math.hypot(vx, vy) / PROBE;
  return {
    ...text,
    height: roundCoordinate(text.height * scale),
    letterSpacing: roundCoordinate(text.letterSpacing * scale),
    placement: {
      position: [ox, oy],
      rotation: roundCoordinate(((turned % 360) + 360) % 360) % 360,
      mirrored: ux * vy - uy * vx < 0,
    },
  };
}
