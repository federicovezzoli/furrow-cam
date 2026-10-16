import { type Rotation, rotatedBounds, rotatedFrameTransform } from "./model";
import type { Heightmap, HeightmapGrid } from "./simulation";
import type { Box3 } from "./stock";

/**
 * The highest point of a triangle mesh above each cell of `grid`, seen from
 * above (ADR-0030): a z-buffer, so overhangs and undercuts are filled in by
 * construction (PRD-0005 S3). `transform` maps the mesh's coordinates into
 * the grid's frame as a row-major 3 × 4 affine matrix (`modelTransform`); the
 * grid's cell `(column, row)` is centred at `((column + 0.5) * cellWidth,
 * (row + 0.5) * cellHeight)`. Cells no triangle covers are at `base`.
 *
 * Each cell takes the height of the triangles over its centre, so details
 * smaller than a cell can be missed; vertical faces cover no area and are
 * drawn by the cells beside them.
 */
export function rasterizeMesh(
  positions: Float32Array,
  transform: readonly number[],
  grid: HeightmapGrid,
  base: number,
): Float32Array {
  const heights = new Float32Array(grid.columns * grid.rows).fill(base);
  rasterizeTriangles(positions, transform, grid, heights, 0, positions.length / 9);
  return heights;
}

/**
 * Raises `heights` to the triangles `first` to `end` (excluded) of a mesh,
 * as `rasterizeMesh` does for all of them: a large mesh can be rasterised a
 * slice at a time.
 */
export function rasterizeTriangles(
  positions: Float32Array,
  transform: readonly number[],
  { columns, rows, cellWidth, cellHeight }: HeightmapGrid,
  heights: Float32Array,
  first: number,
  end: number,
) {
  const [m00 = 0, m01 = 0, m02 = 0, m03 = 0, m10 = 0, m11 = 0, m12 = 0, m13 = 0] = transform;
  const [m20 = 0, m21 = 0, m22 = 0, m23 = 0] = transform.slice(8);
  // Vertices in cell units, so cell centres are at `index + 0.5`.
  const vx = new Float64Array(3);
  const vy = new Float64Array(3);
  const vz = new Float64Array(3);
  const stop = Math.min(end * 9, positions.length);
  for (let t = first * 9; t < stop; t += 9) {
    for (let v = 0; v < 3; v++) {
      const x = positions[t + v * 3] as number;
      const y = positions[t + v * 3 + 1] as number;
      const z = positions[t + v * 3 + 2] as number;
      vx[v] = (m00 * x + m01 * y + m02 * z + m03) / cellWidth;
      vy[v] = (m10 * x + m11 * y + m12 * z + m13) / cellHeight;
      vz[v] = m20 * x + m21 * y + m22 * z + m23;
    }
    const ax = vx[0] as number;
    const bx = vx[1] as number;
    const cx = vx[2] as number;
    const ay = vy[0] as number;
    const by = vy[1] as number;
    const cy = vy[2] as number;
    const az = vz[0] as number;
    const bz = vz[1] as number;
    const cz = vz[2] as number;
    const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
    // Seen edge-on from above: no cell centre lies inside it.
    if (Math.abs(area) < 1e-12) continue;

    const firstColumn = Math.max(0, Math.ceil(Math.min(ax, bx, cx) - 0.5));
    const lastColumn = Math.min(columns - 1, Math.floor(Math.max(ax, bx, cx) - 0.5));
    const firstRow = Math.max(0, Math.ceil(Math.min(ay, by, cy) - 0.5));
    const lastRow = Math.min(rows - 1, Math.floor(Math.max(ay, by, cy) - 0.5));
    // Barycentric weights, signed by the winding so inside is always positive.
    const sign = area > 0 ? 1 : -1;
    const tolerance = -1e-9 * Math.abs(area);
    for (let row = firstRow; row <= lastRow; row++) {
      const py = row + 0.5;
      for (let column = firstColumn; column <= lastColumn; column++) {
        const px = column + 0.5;
        const wa = sign * ((bx - px) * (cy - py) - (cx - px) * (by - py));
        const wb = sign * ((cx - px) * (ay - py) - (ax - px) * (cy - py));
        const wc = sign * ((ax - px) * (by - py) - (bx - px) * (ay - py));
        if (wa < tolerance || wb < tolerance || wc < tolerance) continue;
        const z = (wa * az + wb * bz + wc * cz) / (sign * area);
        const i = row * columns + column;
        if (z > (heights[i] as number)) heights[i] = z;
      }
    }
  }
}

/** Cells of a model's preview heightmap: 1024 × 1024, enough to show it, quick to compute. */
export const MODEL_PREVIEW_CELLS = 1024 * 1024;

/**
 * A mesh with `bounds`, rotated by `rotation`, as a heightmap in its rotated
 * frame (`rotatedFrameTransform`): its outline from `(0, 0)`, its top at
 * `z = 0` and uncovered cells at its bottom, in at most `maxCells` cells as
 * close to square as its outline allows. Scaling and moving it as the
 * placement says shows the model as it will be cut. `null` for a mesh with
 * no width or length seen from above, which has nothing to cut.
 */
export function modelHeightmap(
  positions: Float32Array,
  bounds: Box3,
  rotation: Rotation,
  maxCells = MODEL_PREVIEW_CELLS,
): Heightmap | null {
  const { min, max } = rotatedBounds(bounds, rotation);
  const width = max[0] - min[0];
  const length = max[1] - min[1];
  if (!(width > 0 && length > 0)) return null;
  const size = Math.sqrt((width * length) / maxCells);
  let columns = Math.max(2, Math.ceil(width / size));
  let rows = Math.max(2, Math.ceil(length / size));
  while (columns * rows > maxCells) {
    if (width / columns > length / rows) rows--;
    else columns--;
  }
  const grid = { columns, rows, cellWidth: width / columns, cellHeight: length / rows };
  const heights = rasterizeMesh(
    positions,
    rotatedFrameTransform(bounds, rotation),
    grid,
    min[2] - max[2],
  );
  return { ...grid, heights };
}
