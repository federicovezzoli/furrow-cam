import type { CubicSegment, Point } from "@furrow/document";

/** The quadratic Bézier from `from` through control `q` to `to`, as the cubic it equals. */
export function quadraticToCubic(from: Point, q: Point, to: Point): CubicSegment {
  return {
    kind: "cubic",
    c1: [from[0] + (2 / 3) * (q[0] - from[0]), from[1] + (2 / 3) * (q[1] - from[1])],
    c2: [to[0] + (2 / 3) * (q[0] - to[0]), to[1] + (2 / 3) * (q[1] - to[1])],
    to,
  };
}
