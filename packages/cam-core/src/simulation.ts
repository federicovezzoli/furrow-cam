import type { Stock, Tool } from "@furrow/document";

/**
 * Cells across the smallest tool in use: enough for a slot as narrow as the
 * tool to show its floor and walls (ADR-0019).
 */
export const CELLS_PER_DIAMETER = 6;

/**
 * Most cells a heightmap may have: 2048 × 4096 (32 MB of heights), which keeps
 * a full sheet quick to simulate and to draw (ADR-0019). Devices whose
 * textures can't hold that many get fewer.
 */
export const MAX_HEIGHTMAP_CELLS = 2048 * 4096;

/** What of a tool decides the shape it cuts. */
export type CutterShape = Pick<Tool, "type" | "diameter" | "vAngle" | "tipDiameter">;

/**
 * The moves of one tool, as `LineSegments` positions in stock coordinates
 * (`[x, y, z]` per vertex, two vertices per move, the tool tip's position),
 * like `ToolpathLines`.
 */
export type SimulationCut = { tool: CutterShape; segments: Float32Array };

/**
 * The stock after cutting, seen from above (ADR-0019): a grid over the stock
 * in which each cell holds the height of the stock top at its centre, in
 * stock coordinates (`0` uncut, `-thickness` cut through). Cell `(column,
 * row)` is `heights[row * columns + column]`, centred at
 * `((column + 0.5) * cellWidth, (row + 0.5) * cellHeight)`.
 */
export type Heightmap = {
  columns: number;
  rows: number;
  cellWidth: number;
  cellHeight: number;
  heights: Float32Array;
};

/** The grid of a heightmap, without heights. */
export type HeightmapGrid = Omit<Heightmap, "heights">;

/**
 * The grid for simulating cuts with tools no smaller than `smallestDiameter`
 * on `stock`: `CELLS_PER_DIAMETER` cells across that tool, coarser if it
 * would take more than `maxCells`, and at least two each way.
 * Cells are as close to square as the stock's size allows and cover it exactly.
 */
export function heightmapGrid(
  { width, height }: Pick<Stock, "width" | "height">,
  smallestDiameter: number,
  maxCells = MAX_HEIGHTMAP_CELLS,
): HeightmapGrid {
  let size = smallestDiameter / CELLS_PER_DIAMETER;
  const wanted = Math.ceil(width / size) * Math.ceil(height / size);
  if (wanted > maxCells) size *= Math.sqrt(wanted / maxCells);
  /** At least two cells each way, so there is a surface between cell centres to draw. */
  let columns = Math.max(2, Math.ceil(width / size));
  let rows = Math.max(2, Math.ceil(height / size));
  /** Rounding up may still overshoot the cap by a row or column. */
  while (columns * rows > maxCells) {
    if (width / columns > height / rows) rows--;
    else columns--;
  }
  return { columns, rows, cellWidth: width / columns, cellHeight: height / rows };
}

/**
 * Simulates `cuts` on `stock` (PRD-0001 R10, ADR-0019): each move sweeps its
 * tool's shape across the grid and lowers every cell it passes below. Nothing
 * stays above the stock top or goes below its bottom. Cuts are applied in any
 * order: each cell keeps the lowest the tool reached there. Runs in a Web
 * Worker (ADR-0004); the result is derived data and never stored.
 */
export function simulateCuts(
  stock: Pick<Stock, "width" | "height" | "thickness">,
  cuts: readonly SimulationCut[],
  grid: HeightmapGrid = heightmapGrid(stock, smallestDiameter(cuts)),
): Heightmap {
  const heights = new Float32Array(grid.columns * grid.rows);
  for (const { tool, segments } of cuts) {
    const profile = cutterProfile(tool);
    for (let i = 0; i + 5 < segments.length; i += 6) {
      sweep(grid, heights, profile, segments, i);
    }
  }
  const bottom = -stock.thickness;
  for (let i = 0; i < heights.length; i++) {
    if ((heights[i] as number) < bottom) heights[i] = bottom;
  }
  return { ...grid, heights };
}

/** The smallest diameter of the tools of `cuts`, or `Infinity` with none. */
export function smallestDiameter(cuts: readonly SimulationCut[]): number {
  return cuts.reduce((least, { tool }) => Math.min(least, tool.diameter), Infinity);
}

/**
 * A tool's shape as the height of its cutting edge above the tip at each
 * distance from its axis, up to `radius`; nothing cuts beyond.
 */
type CutterProfile = {
  radius: number;
  /** Whether the edge is level across the whole radius (flat end mills, drills). */
  flat: boolean;
  height: (distance: number) => number;
};

/**
 * Flat end mills and drills cut a flat bottom (the document has no drill
 * point angle), ball end mills a hemisphere, V-bits a cone over their flat
 * tip. Each profile rises with distance and is convex, which `sweep` relies on.
 */
export function cutterProfile({ type, diameter, vAngle, tipDiameter }: CutterShape): CutterProfile {
  const radius = diameter / 2;
  switch (type) {
    case "flat_end_mill":
    case "drill":
      return { radius, flat: true, height: () => 0 };
    case "ball_end_mill":
      return {
        radius,
        flat: false,
        height: (d) => radius - Math.sqrt(Math.max(radius * radius - d * d, 0)),
      };
    case "v_bit": {
      const tip = (tipDiameter ?? 0) / 2;
      const slope = 1 / Math.tan((((vAngle ?? 90) / 2) * Math.PI) / 180);
      return { radius, flat: tip >= radius, height: (d) => Math.max(d - tip, 0) * slope };
    }
  }
}

/** Steps of the golden-section search: shrinks the interval below 10⁻⁹ of the move. */
const SEARCH_STEPS = 44;
const INVERSE_PHI = (Math.sqrt(5) - 1) / 2;

/**
 * Lowers the cells the tool passes below on the move `segments[i..i + 5]`.
 * At a cell `q` the tool reaches down to `min z(t) + height(|q − p(t)|)` over
 * the move's points `p(t)` within its radius: `z` is linear in `t` and the
 * profile rises and is convex with distance, so that is a convex function of
 * `t`. Its minimum lies at the closest point on a level move and at an end of
 * the range within reach for a flat tool; otherwise a golden-section search
 * finds it.
 */
function sweep(
  grid: HeightmapGrid,
  heights: Float32Array,
  { radius, flat, height }: CutterProfile,
  segments: Float32Array,
  i: number,
) {
  const { columns, rows, cellWidth, cellHeight } = grid;
  const ax = segments[i] as number;
  const ay = segments[i + 1] as number;
  const az = segments[i + 2] as number;
  const dx = (segments[i + 3] as number) - ax;
  const dy = (segments[i + 4] as number) - ay;
  const dz = (segments[i + 5] as number) - az;
  /** Above the stock, the tool cuts nothing. */
  if (Math.min(az, az + dz) >= 0) return;
  const length2 = dx * dx + dy * dy;
  const radius2 = radius * radius;

  const firstRow = Math.max(0, Math.ceil((Math.min(ay, ay + dy) - radius) / cellHeight - 0.5));
  const lastRow = Math.min(
    rows - 1,
    Math.floor((Math.max(ay, ay + dy) + radius) / cellHeight - 0.5),
  );
  for (let row = firstRow; row <= lastRow; row++) {
    const y = (row + 0.5) * cellHeight;
    /** The part of the move within `radius` of this row bounds the cells in reach. */
    let t0 = 0;
    let t1 = 1;
    if (dy !== 0) {
      const ta = (y - radius - ay) / dy;
      const tb = (y + radius - ay) / dy;
      t0 = Math.max(0, Math.min(ta, tb));
      t1 = Math.min(1, Math.max(ta, tb));
      if (t0 > t1) continue;
    } else if (Math.abs(y - ay) > radius) {
      continue;
    }
    const xa = ax + dx * t0;
    const xb = ax + dx * t1;
    const firstColumn = Math.max(0, Math.ceil((Math.min(xa, xb) - radius) / cellWidth - 0.5));
    const lastColumn = Math.min(
      columns - 1,
      Math.floor((Math.max(xa, xb) + radius) / cellWidth - 0.5),
    );

    for (let column = firstColumn; column <= lastColumn; column++) {
      const x = (column + 0.5) * cellWidth;
      const qx = x - ax;
      const qy = y - ay;
      /** The range of `t` within reach: `|q − p(t)|² ≤ radius²`, a quadratic in `t`. */
      let start: number;
      let end: number;
      let closest: number;
      if (length2 === 0) {
        if (qx * qx + qy * qy > radius2) continue;
        start = 0;
        end = 1;
        closest = 0;
      } else {
        const along = (qx * dx + qy * dy) / length2;
        const across2 = qx * qx + qy * qy - along * along * length2;
        if (across2 > radius2) continue;
        const half = Math.sqrt((radius2 - across2) / length2);
        start = Math.max(0, along - half);
        end = Math.min(1, along + half);
        if (start > end) continue;
        closest = Math.min(Math.max(along, start), end);
      }

      const at = (t: number) => {
        const px = qx - dx * t;
        const py = qy - dy * t;
        return az + dz * t + height(Math.sqrt(px * px + py * py));
      };
      let lowest: number;
      if (dz === 0) lowest = at(closest);
      else if (flat) lowest = az + dz * (dz < 0 ? end : start);
      else lowest = goldenMinimum(at, start, end);

      const cell = row * columns + column;
      if (lowest < (heights[cell] as number)) heights[cell] = lowest;
    }
  }
}

/** The least value of the convex `f` on `[a, b]`. */
function goldenMinimum(f: (t: number) => number, a: number, b: number): number {
  let lo = a;
  let hi = b;
  let c = hi - INVERSE_PHI * (hi - lo);
  let d = lo + INVERSE_PHI * (hi - lo);
  let fc = f(c);
  let fd = f(d);
  for (let step = 0; step < SEARCH_STEPS; step++) {
    if (fc < fd) {
      hi = d;
      d = c;
      fd = fc;
      c = hi - INVERSE_PHI * (hi - lo);
      fc = f(c);
    } else {
      lo = c;
      c = d;
      fc = fd;
      d = lo + INVERSE_PHI * (hi - lo);
      fd = f(d);
    }
  }
  return Math.min(fc, fd, f(a), f(b));
}

/** The buffer of `heightmap`, to transfer it to another thread instead of copying. */
export function heightmapBuffers({ heights }: Heightmap): ArrayBuffer[] {
  return [heights.buffer as ArrayBuffer];
}
