import type { PatternSettings, Point } from "@furrow/document";
import type { Rect } from "../geometry/bounds";
import { difference, type Polygon } from "../geometry/clipper";
import { arcStep } from "../geometry/flatten";

// The cells of each cell type (PRD-0016 P6), in the pattern's own frame: its
// origin at (0, 0), x along its rows. Every cell is placed from that origin, so
// the same settings give the same cells wherever the boundary lies.

/** A motif of closed cells repeated at every `i·a + j·b`. */
export type Lattice = { a: Point; b: Point; motif: Polygon[] };

const SQRT3 = Math.sqrt(3);

/** The lattice of a cell type of closed cells that repeat, or `null` for the others. */
export function cellLattice({ cell, size: s }: PatternSettings, tolerance: number): Lattice | null {
  switch (cell) {
    case "square":
      return { a: [s, 0], b: [0, s], motif: [rect(0, 0, s, s)] };
    case "brick":
      return {
        a: [s, 0],
        b: [0, s],
        motif: [rect(0, 0, s, s / 2), rect(s / 2, s / 2, s, s / 2)],
      };
    case "hexagon": {
      // Pointy-top, `s` across the flats.
      const radius = s / SQRT3;
      return { a: [s, 0], b: [s / 2, 1.5 * radius], motif: [regular([0, 0], radius, 6, 90)] };
    }
    case "triangle": {
      const h = (s * SQRT3) / 2;
      const up: Polygon = [
        [0, 0],
        [s, 0],
        [s / 2, h],
      ];
      const down: Polygon = [
        [s, 0],
        [1.5 * s, h],
        [s / 2, h],
      ];
      return { a: [s, 0], b: [s / 2, h], motif: [up, down] };
    }
    case "diamond":
      return { a: [s / 2, s / 2], b: [s / 2, -s / 2], motif: [regular([0, 0], s / 2, 4, 0)] };
    case "circleSquare":
      return { a: [s, 0], b: [0, s], motif: [circle([0, 0], s / 2, tolerance)] };
    case "circleHex":
      return { a: [s, 0], b: [s / 2, (s * SQRT3) / 2], motif: [circle([0, 0], s / 2, tolerance)] };
    case "herringbone": {
      // Bricks `s` long and `s / 2` wide, one along each axis per repeat.
      const w = s / 2;
      return { a: [w, w], b: [s, -s], motif: [rect(0, 0, s, w), rect(0, w, w, s)] };
    }
    case "basketWeave": {
      // Blocks of two strips, turned a quarter on alternate blocks.
      const h = s / 2;
      const across = [rect(0, 0, s, h), rect(0, h, s, h)];
      const along = [rect(s, 0, h, s), rect(s + h, 0, h, s)];
      return { a: [2 * s, 0], b: [s, s], motif: [...across, ...along] };
    }
    case "fishScale": {
      // Each disk less the two of the row above that overlap it tiles the plane.
      const r = s / 2;
      const scale = difference(
        [circle([0, 0], r, tolerance)],
        [circle([r, r], r, tolerance), circle([-r, r], r, tolerance)],
      );
      return { a: [s, 0], b: [r, r], motif: scale };
    }
    case "chevron": {
      const h = s / 2;
      const chevron: Polygon = [
        [0, 0],
        [s / 2, h],
        [s, 0],
        [s, h],
        [s / 2, 2 * h],
        [0, h],
      ];
      return { a: [s, 0], b: [0, h], motif: [chevron] };
    }
    case "star":
      return { a: [s, 0], b: [0, s], motif: [star([0, 0], s / 2)] };
    default:
      return null;
  }
}

/** The polylines of a line cell type that cover `bounds`, or `null` for the others. */
export function cellLines(
  { cell, size: s, amplitude, wavelength, seed }: PatternSettings,
  bounds: Rect,
  tolerance: number,
): Point[][] | null {
  // Reach past the bounds by a cell, so lines cross the whole boundary.
  const margin = s + amplitude;
  const [x0, y0] = [bounds.min[0] - margin, bounds.min[1] - margin];
  const [x1, y1] = [bounds.max[0] + margin, bounds.max[1] + margin];
  const rows = (pitch: number, from: number, to: number) => {
    const result: number[] = [];
    for (let k = Math.floor(from / pitch); k * pitch <= to; k++) result.push(k * pitch);
    return result;
  };
  switch (cell) {
    case "lines":
      return rows(s, y0, y1).map((y) => [
        [x0, y],
        [x1, y],
      ]);
    case "crosshatch":
      return [
        ...rows(s, y0, y1).map((y): Point[] => [
          [x0, y],
          [x1, y],
        ]),
        ...rows(s, x0, x1).map((x): Point[] => [
          [x, y0],
          [x, y1],
        ]),
      ];
    case "wave": {
      const half = amplitude / 2;
      const k = (2 * Math.PI) / wavelength;
      const step = lineStep({ cell, size: s, amplitude, wavelength } as PatternSettings, tolerance);
      const xs = rows(step, x0, x1 + step);
      return rows(s, y0, y1).map((y) => xs.map((x): Point => [x, y + half * Math.sin(k * x)]));
    }
    case "zigzag": {
      const half = wavelength / 2;
      const xs = rows(half, x0, x1 + half);
      return rows(s, y0, y1).map((y) =>
        xs.map((x): Point => [x, y + (Math.round(x / half) % 2 === 0 ? -1 : 1) * (amplitude / 2)]),
      );
    }
    case "truchet": {
      // Two quarter arcs per tile, joining its sides' midpoints round one
      // diagonal's corners or the other's, chosen by the seed.
      const r = s / 2;
      const result: Point[][] = [];
      for (const x of rows(s, x0, x1)) {
        for (const y of rows(s, y0, y1)) {
          const flipped = random(seed, Math.round(x / s), Math.round(y / s)) < 0.5;
          const corners: [Point, number][] = flipped
            ? [
                [[x + s, y], 90],
                [[x, y + s], 270],
              ]
            : [
                [[x, y], 0],
                [[x + s, y + s], 180],
              ];
          for (const [center, from] of corners) result.push(arc(center, r, from, 90, tolerance));
        }
      }
      return result;
    }
    default:
      return null;
  }
}

/**
 * How far apart a line cell type's points lie along its lines: a wave's
 * chords, a zigzag's corners; a cell's size for the others.
 */
export function lineStep(
  { cell, size, amplitude, wavelength }: PatternSettings,
  tolerance: number,
): number {
  if (cell === "zigzag") return wavelength / 2;
  if (cell !== "wave") return size;
  const k = (2 * Math.PI) / wavelength;
  // A chord of length h strays at most (amplitude / 2)·k²·h²/8 from a sine.
  return Math.min(wavelength / 8, Math.sqrt((16 * tolerance) / (amplitude * k * k)));
}

/**
 * Voronoi cells of sites jittered on a grid of `size`, the jitter drawn from
 * `seed` and each site's grid cell, so a site stays put as the bounds change.
 */
export function voronoiCells({ size: s, seed }: PatternSettings, bounds: Rect): Polygon[] {
  const site = (i: number, j: number): Point => [
    (i + 0.15 + 0.7 * random(seed, i, j, 0)) * s,
    (j + 0.15 + 0.7 * random(seed, i, j, 1)) * s,
  ];
  const cells: Polygon[] = [];
  // A site two columns or rows out can still own a point at the bounds' edge.
  const [i0, j0] = [Math.floor(bounds.min[0] / s) - 2, Math.floor(bounds.min[1] / s) - 2];
  const [i1, j1] = [Math.ceil(bounds.max[0] / s) + 1, Math.ceil(bounds.max[1] / s) + 1];
  for (let i = i0; i <= i1; i++) {
    for (let j = j0; j <= j1; j++) {
      const p = site(i, j);
      // Sites jittered within their grid cell have their neighbours within two cells.
      let cell = rect(p[0] - 2 * s, p[1] - 2 * s, 4 * s, 4 * s);
      for (let di = -2; di <= 2; di++) {
        for (let dj = -2; dj <= 2; dj++) {
          if (di !== 0 || dj !== 0) cell = halfPlane(cell, p, site(i + di, j + dj));
        }
      }
      if (cell.length >= 3) cells.push(cell);
    }
  }
  return cells;
}

/** The part of the convex `polygon` nearer to `p` than to `q`. */
function halfPlane(polygon: Polygon, p: Point, q: Point): Polygon {
  const n: Point = [q[0] - p[0], q[1] - p[1]];
  const c = (n[0] * (p[0] + q[0])) / 2 + (n[1] * (p[1] + q[1])) / 2;
  const side = ([x, y]: Point) => n[0] * x + n[1] * y - c;
  const result: Polygon = [];
  polygon.forEach((a, i) => {
    const b = polygon[(i + 1) % polygon.length] as Point;
    const [sa, sb] = [side(a), side(b)];
    if (sa <= 0) result.push(a);
    if ((sa < 0 && sb > 0) || (sa > 0 && sb < 0)) {
      const t = sa / (sa - sb);
      result.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
    }
  });
  return result;
}

function rect(x: number, y: number, w: number, h: number): Polygon {
  return [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
  ];
}

/** A regular polygon of `count` corners `radius` from `center`, the first at `start` degrees. */
function regular(center: Point, radius: number, count: number, start: number): Polygon {
  return Array.from({ length: count }, (_, k) => polar(center, radius, start + (360 * k) / count));
}

/** A five-pointed star, its points `radius` from `center`, one pointing up. */
function star(center: Point, radius: number): Polygon {
  const inner = radius * 0.382;
  return Array.from({ length: 10 }, (_, k) => polar(center, k % 2 ? inner : radius, 90 + 36 * k));
}

function circle(center: Point, radius: number, tolerance: number): Polygon {
  return arc(center, radius, 0, 360, tolerance).slice(0, -1);
}

/** The polyline of an arc from `from` degrees sweeping `sweep` counter-clockwise. */
function arc(center: Point, radius: number, from: number, sweep: number, tolerance: number) {
  const count = Math.max(1, Math.ceil((sweep * Math.PI) / 180 / arcStep(radius, tolerance) - 1e-9));
  return Array.from({ length: count + 1 }, (_, k) =>
    polar(center, radius, from + (sweep * k) / count),
  );
}

function polar([x, y]: Point, radius: number, degrees: number): Point {
  const angle = (degrees * Math.PI) / 180;
  return [x + radius * Math.cos(angle), y + radius * Math.sin(angle)];
}

/** A number in [0, 1) that depends only on its arguments (a 32-bit integer hash). */
function random(seed: number, i: number, j: number, k = 0): number {
  let h = seed ^ Math.imul(i, 0x9e3779b1) ^ Math.imul(j, 0x85ebca77) ^ Math.imul(k, 0xc2b2ae3d);
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return ((h ^ (h >>> 16)) >>> 0) / 2 ** 32;
}
