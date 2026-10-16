import type { Path, Point } from "@furrow/document";
import { roundCoordinate } from "../geometry/round";
import { apply, type Matrix } from "./svg/transform";

/** Whether every coordinate is finite: huge numbers in a file overflow to `Infinity` or `NaN`. */
export function isFinitePath(path: Path): boolean {
  const finite = ([x, y]: Point) => Number.isFinite(x) && Number.isFinite(y);
  return (
    finite(path.start) &&
    path.segments.every((segment) => {
      if (segment.kind === "line") return finite(segment.to);
      if (segment.kind === "arc") return finite(segment.to) && finite(segment.center);
      return finite(segment.c1) && finite(segment.c2) && finite(segment.to);
    })
  );
}

/** `point` through `matrix`, rounded like every imported coordinate. */
export function toStock(matrix: Matrix, point: Point): Point {
  const [x, y] = apply(matrix, point);
  return [roundCoordinate(x), roundCoordinate(y)];
}

export function defaultCreateId(): string {
  // Workers and Node both have Web Crypto; the package's lib types don't include it.
  return (globalThis as unknown as { crypto: { randomUUID(): string } }).crypto.randomUUID();
}
