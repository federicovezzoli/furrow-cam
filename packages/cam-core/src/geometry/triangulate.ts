import type { Point } from "@furrow/document";
import earcut from "earcut";

// Polygon triangulation adapter (ADR-0077). The rest of the CAM core uses this
// function and never imports earcut directly.

/**
 * Triangulates the polygon `outer` with its `holes`, each a ring that doesn't
 * repeat its first point. Returns the triangles as index triples into the
 * rings' points, numbered in order: `outer` first, then each hole. Duplicate
 * and collinear points are left out of every triangle.
 */
export function triangulate(outer: readonly Point[], holes: readonly (readonly Point[])[] = []) {
  const data: number[] = [];
  const holeStarts: number[] = [];
  for (const [x, y] of outer) data.push(x, y);
  for (const hole of holes) {
    holeStarts.push(data.length / 2);
    for (const [x, y] of hole) data.push(x, y);
  }
  return earcut(data, holeStarts.length > 0 ? holeStarts : null);
}
