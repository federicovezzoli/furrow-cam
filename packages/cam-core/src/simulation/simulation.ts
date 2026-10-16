import type { Stock, Tool } from "@furrow/document";

/**
 * Cells across the narrowest cut: enough for a slot that narrow to show its
 * floor and walls (ADR-0019).
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
 * The grid for simulating cuts no narrower than `smallestWidth` on `stock`
 * (see `smallestCutWidth`): `CELLS_PER_DIAMETER` cells across that width,
 * coarser if it would take more than `maxCells`, and at least two each way.
 * Cells are as close to square as the stock's size allows and cover it exactly.
 */
export function heightmapGrid(
  { width, height }: Pick<Stock, "width" | "height">,
  smallestWidth: number,
  maxCells = MAX_HEIGHTMAP_CELLS,
): HeightmapGrid {
  let size = smallestWidth / CELLS_PER_DIAMETER;
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
 *
 * The buffer under `heights` is padded to a multiple of `bufferMultiple`
 * cells, so a renderer that wraps the cells onto rows of that many texels can
 * upload it as it is, without a copy.
 */
export function simulateCuts(
  stock: Pick<Stock, "width" | "height" | "thickness">,
  cuts: readonly SimulationCut[],
  grid: HeightmapGrid = heightmapGrid(stock, smallestCutWidth(cuts)),
  bufferMultiple = 1,
): Heightmap {
  const cells = grid.columns * grid.rows;
  const padded = Math.ceil(cells / bufferMultiple) * bufferMultiple;
  const heights = new Float32Array(new ArrayBuffer(padded * 4), 0, cells);
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

/**
 * Lowers the cells of `heights` that the moves `first` to `last - 1` of
 * `segments` (six numbers each, as in `SimulationCut`) pass below, as
 * `simulateCuts` does, without clamping: for sweeping a long toolpath a slice
 * at a time. Where a sloped move's lowest point is searched for, it is found
 * to within `tolerance` along the move, which leaves cells no lower than
 * the exact sweep would and is much faster for long toolpaths.
 */
export function sweepMoves(
  grid: HeightmapGrid,
  heights: Float32Array,
  profile: CutterProfile,
  segments: Float32Array,
  first: number,
  last: number,
  tolerance = 0,
) {
  const end = Math.min(last, Math.floor(segments.length / 6));
  for (let move = first; move < end; move++) {
    sweep(grid, heights, profile, segments, move * 6, tolerance);
  }
}

/**
 * Of a V-bit cut's deepest move, how deep the groove whose width sets the
 * grid is: V-carving narrows to nothing towards corners and thin strokes, so
 * the widest groove alone would leave those a cell or two across.
 */
const V_BIT_DEPTH_FRACTION = 0.25;

/**
 * The narrowest of `cuts`: the width each tool cuts at the stock top at its
 * deepest move, its diameter for flat end mills and drills, less for V-bits
 * and ball end mills cutting shallower than their cone or radius. For V-bits,
 * at `V_BIT_DEPTH_FRACTION` of that depth. `Infinity` when nothing goes into
 * the stock.
 */
export function smallestCutWidth(cuts: readonly SimulationCut[]): number {
  let least = Infinity;
  for (const { tool, segments } of cuts) {
    let deepest = 0;
    for (let i = 2; i < segments.length; i += 3) {
      deepest = Math.min(deepest, segments[i] as number);
    }
    if (deepest >= 0) continue;
    const depth = tool.type === "v_bit" ? -deepest * V_BIT_DEPTH_FRACTION : -deepest;
    least = Math.min(least, 2 * cutterProfile(tool).reach(depth));
  }
  return least;
}

/**
 * A tool's shape as the height of its cutting edge above the tip at each
 * distance from its axis, up to `radius`; nothing cuts beyond.
 */
export type CutterProfile = {
  radius: number;
  /** Whether the edge is level across the whole radius (flat end mills, drills). */
  flat: boolean;
  height: (distance: number) => number;
  /** How far from its axis the edge is less than `depth` above the tip: the inverse of `height`, at most `radius`. */
  reach: (depth: number) => number;
};

/**
 * Flat end mills and drills cut a flat bottom (the document has no drill
 * point angle), ball end mills a hemisphere, V-bits a cone over their flat
 * tip (always narrower than the bit, the tool schema says). Each profile
 * rises with distance and is convex, which `sweep` relies on.
 */
export function cutterProfile({ type, diameter, vAngle, tipDiameter }: CutterShape): CutterProfile {
  const radius = diameter / 2;
  switch (type) {
    case "flat_end_mill":
    case "drill":
      return { radius, flat: true, height: () => 0, reach: () => radius };
    case "ball_end_mill":
      return {
        radius,
        flat: false,
        height: (d) => radius - Math.sqrt(Math.max(radius * radius - d * d, 0)),
        reach: (depth) =>
          depth >= radius ? radius : Math.sqrt(radius * radius - (radius - depth) ** 2),
      };
    case "v_bit": {
      const tip = (tipDiameter ?? 0) / 2;
      const slope = 1 / Math.tan((((vAngle ?? 90) / 2) * Math.PI) / 180);
      return {
        radius,
        flat: false,
        height: (d) => Math.max(d - tip, 0) * slope,
        reach: (depth) => Math.min(radius, tip + depth / slope),
      };
    }
  }
}

/** Steps of the golden-section search: shrinks the interval below 10⁻⁹ of the move. */
const SEARCH_STEPS = 44;
const INVERSE_PHI = (Math.sqrt(5) - 1) / 2;

/**
 * Lowers the cells the tool passes below on the move `segments[i..i + 5]`.
 * Only cells within the tool's reach at the move's deepest point can go
 * below the stock top, so a V-bit carving shallow sweeps a narrow band, not
 * its whole diameter.
 * At a cell `q` the tool reaches down to `min z(t) + height(|q − p(t)|)` over
 * the move's points `p(t)` within its radius: `z` is linear in `t` and the
 * profile rises and is convex with distance, so that is a convex function of
 * `t`. Its minimum lies at the closest point on a level move and at an end of
 * the range within reach for a flat tool; otherwise a golden-section search
 * finds it, to within `tolerance` along the move (`0` for exact). Stopping
 * early can only leave a cell higher than the exact sweep would.
 */
function sweep(
  grid: HeightmapGrid,
  heights: Float32Array,
  { radius: fullRadius, flat, height, reach }: CutterProfile,
  segments: Float32Array,
  i: number,
  tolerance = 0,
) {
  const { columns, rows, cellWidth, cellHeight } = grid;
  const ax = segments[i] as number;
  const ay = segments[i + 1] as number;
  const az = segments[i + 2] as number;
  const dx = (segments[i + 3] as number) - ax;
  const dy = (segments[i + 4] as number) - ay;
  const dz = (segments[i + 5] as number) - az;
  /** Above the stock, the tool cuts nothing. */
  const deepest = Math.min(az, az + dz);
  if (deepest >= 0) return;
  const radius = Math.min(fullRadius, reach(-deepest));
  const length2 = dx * dx + dy * dy;
  const radius2 = radius * radius;
  const steps =
    tolerance > 0
      ? Math.min(
          SEARCH_STEPS,
          Math.max(
            0,
            Math.ceil(Math.log(Math.hypot(dx, dy, dz) / tolerance) / -Math.log(INVERSE_PHI)),
          ),
        )
      : SEARCH_STEPS;

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
      /** The least distance from `q` to the move's line. */
      let across2: number;
      if (length2 === 0) {
        across2 = qx * qx + qy * qy;
        if (across2 > radius2) continue;
        start = 0;
        end = 1;
        closest = 0;
      } else {
        const along = (qx * dx + qy * dy) / length2;
        across2 = qx * qx + qy * qy - along * along * length2;
        if (across2 > radius2) continue;
        const half = Math.sqrt((radius2 - across2) / length2);
        start = Math.max(0, along - half);
        end = Math.min(1, along + half);
        if (start > end) continue;
        closest = Math.min(Math.max(along, start), end);
      }

      const cell = row * columns + column;
      const current = heights[cell] as number;
      let lowest: number;
      if (dz === 0) {
        const px = qx - dx * closest;
        const py = qy - dy * closest;
        lowest = az + height(Math.sqrt(px * px + py * py));
      } else if (flat) {
        lowest = az + dz * (dz < 0 ? end : start);
      } else {
        // The move's lowest point in reach, with the tool's edge at its least
        // distance, bounds what the search can find: skip it when the cell
        // is already lower, as it mostly is where passes overlap.
        const bound = az + dz * (dz < 0 ? end : start) + height(Math.sqrt(Math.max(across2, 0)));
        if (bound >= current) continue;
        lowest = lowestAlong(qx, qy, dx, dy, az, dz, height, start, end, steps);
      }

      if (lowest < current) heights[cell] = lowest;
    }
  }
}

/** How low the tool reaches at `q` from `t` along the move: `az + dz·t + height(|q − p(t)|)`. */
function reachAt(
  qx: number,
  qy: number,
  dx: number,
  dy: number,
  az: number,
  dz: number,
  height: (distance: number) => number,
  t: number,
): number {
  const px = qx - dx * t;
  const py = qy - dy * t;
  return az + dz * t + height(Math.sqrt(px * px + py * py));
}

/**
 * The least of `reachAt` for `t` in `[a, b]`, by golden-section search.
 * Plain functions rather than a closure per cell: this runs for every cell a
 * ramp passes.
 */
function lowestAlong(
  qx: number,
  qy: number,
  dx: number,
  dy: number,
  az: number,
  dz: number,
  height: (distance: number) => number,
  a: number,
  b: number,
  steps: number,
): number {
  let lo = a;
  let hi = b;
  let c = hi - INVERSE_PHI * (hi - lo);
  let d = lo + INVERSE_PHI * (hi - lo);
  let fc = reachAt(qx, qy, dx, dy, az, dz, height, c);
  let fd = reachAt(qx, qy, dx, dy, az, dz, height, d);
  for (let step = 0; step < steps; step++) {
    if (fc < fd) {
      hi = d;
      d = c;
      fd = fc;
      c = hi - INVERSE_PHI * (hi - lo);
      fc = reachAt(qx, qy, dx, dy, az, dz, height, c);
    } else {
      lo = c;
      c = d;
      fc = fd;
      d = lo + INVERSE_PHI * (hi - lo);
      fd = reachAt(qx, qy, dx, dy, az, dz, height, d);
    }
  }
  return Math.min(
    fc,
    fd,
    reachAt(qx, qy, dx, dy, az, dz, height, a),
    reachAt(qx, qy, dx, dy, az, dz, height, b),
  );
}

/** The buffer of `heightmap`, to transfer it to another thread instead of copying. */
export function heightmapBuffers({ heights }: Heightmap): ArrayBuffer[] {
  return [heights.buffer as ArrayBuffer];
}
