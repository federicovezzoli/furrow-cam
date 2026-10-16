import type { Point } from "@furrow/document";
import type { Polygon } from "./geometry";
import { distanceToSegment } from "./passes";
import type { HeightmapGrid } from "./simulation";

/**
 * How far above a level a cell must be to count as above it: heights are
 * `float32`, so a cell meant to be exactly at the level may round just above.
 */
export const CONTOUR_TOLERANCE = 1e-4;

/** Steps along the grid lines, counter-clockwise from +X: `[dx, dy]`. */
const STEPS = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
] as const;

/**
 * The outlines of the cells of `heights` higher than `level` (ADR-0030):
 * rings along the cell edges, so every such cell is inside them whole, in
 * the grid's coordinates moved by `origin`. Outer boundaries wind
 * counter-clockwise and holes (cells at or below the level, enclosed)
 * clockwise; straight runs are one edge. Cells that touch only at a corner
 * get rings of their own.
 */
export function heightContours(
  heights: ArrayLike<number>,
  { columns, rows, cellWidth, cellHeight }: HeightmapGrid,
  level: number,
  origin: Point = [0, 0],
): Polygon[] {
  const threshold = level + CONTOUR_TOLERANCE;
  const above = (column: number, row: number) =>
    column >= 0 &&
    column < columns &&
    row >= 0 &&
    row < rows &&
    (heights[row * columns + column] as number) > threshold;

  /**
   * Whether the edge from vertex `(x, y)` along `STEPS[direction]` bounds a
   * cell above the level on its left and one at or below it on its right.
   */
  const boundary = (x: number, y: number, direction: number) => {
    switch (direction) {
      case 0:
        return above(x, y) && !above(x, y - 1);
      case 1:
        return above(x - 1, y) && !above(x, y);
      case 2:
        return above(x - 1, y - 1) && !above(x - 1, y);
      default:
        return above(x, y - 1) && !above(x - 1, y - 1);
    }
  };

  // Every ring has an edge along the bottom of a cell above the level (its
  // lowest edge for an outer boundary, its highest for a hole), so rings are
  // started from those, each marked as it is walked.
  const walked = new Uint8Array(columns * rows);
  const rings: Polygon[] = [];
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const cell = row * columns + column;
      if (walked[cell] || !boundary(column, row, 0)) continue;
      const ring: Point[] = [];
      let x = column;
      let y = row;
      let direction = 0;
      do {
        if (direction === 0) walked[y * columns + x] = 1;
        const [dx, dy] = STEPS[direction] as readonly [number, number];
        x += dx;
        y += dy;
        // Turn left where possible, so cells touching at a corner stay apart.
        const left = (direction + 1) % 4;
        const right = (direction + 3) % 4;
        const next = boundary(x, y, left) ? left : boundary(x, y, direction) ? direction : right;
        if (next !== direction) {
          ring.push([origin[0] + x * cellWidth, origin[1] + y * cellHeight]);
        }
        direction = next;
      } while (x !== column || y !== row || direction !== 0);
      rings.push(ring);
    }
  }
  return rings;
}

/**
 * `ring` with fewer points, none of its own further than `tolerance` from
 * the result (Douglas-Peucker), so the result grown by twice `tolerance`
 * covers the area `ring` encloses, whatever its winding. Contours along
 * cell edges are staircases, and offsetting every step of them is slow.
 * A ring no wider than `tolerance`, such as a single cell, would shrink to
 * a line that encloses nothing: it is kept as it is.
 */
export function simplifyContour(ring: Polygon, tolerance: number): Polygon {
  const count = ring.length;
  if (count <= 3) return ring;
  // Split at the point furthest from the first, then simplify each half.
  const first = ring[0] as Point;
  let far = 0;
  let farthest = -1;
  for (let i = 1; i < count; i++) {
    const d = Math.hypot((ring[i] as Point)[0] - first[0], (ring[i] as Point)[1] - first[1]);
    if (d > farthest) {
      farthest = d;
      far = i;
    }
  }
  const keep = new Uint8Array(count + 1);
  keep[0] = 1;
  keep[far] = 1;
  keep[count] = 1;
  const at = (i: number) => ring[i % count] as Point;
  const stack: [number, number][] = [
    [0, far],
    [far, count],
  ];
  while (stack.length > 0) {
    const [a, b] = stack.pop() as [number, number];
    let worst = -1;
    let worstDistance = tolerance;
    for (let i = a + 1; i < b; i++) {
      const d = distanceToSegment(at(i), at(a), at(b));
      if (d > worstDistance) {
        worstDistance = d;
        worst = i;
      }
    }
    if (worst < 0) continue;
    keep[worst] = 1;
    stack.push([a, worst], [worst, b]);
  }
  const kept: Point[] = [];
  for (let i = 0; i < count; i++) if (keep[i]) kept.push(ring[i] as Point);
  return kept.length >= 3 ? kept : ring;
}
