import type { Point } from "@furrow/document";
import type { HeightmapGrid } from "./simulation";

/**
 * The first point from `start` along the unit `direction`, a cell at a time,
 * whose cell of `grid` (from (0, 0)) `covered` says has model under it, with
 * the steps it took; `null` if none. Holding tabs are carried inward with it,
 * both as cut and as drawn, so the two end at the same place (#608).
 */
export function walkInward(
  { columns, rows, cellWidth, cellHeight }: HeightmapGrid,
  [u0, v0]: Point,
  [du, dv]: Point,
  covered: (cell: number) => boolean,
): { point: Point; steps: number } | null {
  const step = Math.min(cellWidth, cellHeight);
  const steps = Math.ceil(Math.hypot(columns * cellWidth, rows * cellHeight) / step);
  let entered = false;
  for (let k = 0; k <= steps; k++) {
    const u = u0 + du * k * step;
    const v = v0 + dv * k * step;
    // On a cell edge, the cell inwards: walks start on the grid's edge.
    const column = Math.floor(u / cellWidth + du * 1e-9);
    const row = Math.floor(v / cellHeight + dv * 1e-9);
    if (column < 0 || column >= columns || row < 0 || row >= rows) {
      // Crossed the grid and out the far side: nothing further on.
      if (entered) return null;
      continue;
    }
    entered = true;
    if (covered(row * columns + column)) return { point: [u, v], steps: k };
  }
  return null;
}
