import type { Path, Point, Segment, Shape } from "@furrow/document";
import { roundCoordinate } from "./round";

/**
 * Translations of stored geometry, rounded like imported coordinates so that
 * moving a design back and forth doesn't pile up float noise.
 */

export function translatePoint([x, y]: Point, [dx, dy]: Point): Point {
  return [roundCoordinate(x + dx), roundCoordinate(y + dy)];
}

export function translatePath(path: Path, offset: Point): Path {
  const move = (point: Point) => translatePoint(point, offset);
  return {
    start: move(path.start),
    segments: path.segments.map((segment): Segment => {
      if (segment.kind === "line") return { kind: "line", to: move(segment.to) };
      if (segment.kind === "arc") {
        return { ...segment, to: move(segment.to), center: move(segment.center) };
      }
      return { kind: "cubic", c1: move(segment.c1), c2: move(segment.c2), to: move(segment.to) };
    }),
    closed: path.closed,
  };
}

export function translateShape(shape: Shape, offset: Point): Shape {
  return { ...shape, paths: shape.paths.map((path) => translatePath(path, offset)) };
}

/** `shapes` moved by `offset`: the same array when it doesn't move them. */
export function translateShapes(shapes: Shape[], offset: Point): Shape[] {
  if (offset[0] === 0 && offset[1] === 0) return shapes;
  return shapes.map((shape) => translateShape(shape, offset));
}
