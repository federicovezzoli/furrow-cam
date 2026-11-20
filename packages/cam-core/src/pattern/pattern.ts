import {
  GEOMETRY_TOLERANCE,
  LINE_PATTERN_CELLS,
  type Path,
  type PatternSettings,
  type Point,
  type TextPlacement,
} from "@furrow/document";
import { joinRects, type Rect } from "../geometry/bounds";
import {
  clipLines,
  clipToRect,
  containmentIn,
  intersectionEach,
  offset,
  type Polygon,
  signedArea,
} from "../geometry/clipper";
import { DEFAULT_CHORD_TOLERANCE, flattenPath } from "../geometry/flatten";
import { cleanPath, polygonPath } from "../geometry/path";
import { textFrame } from "../geometry/scale";
import { cellLattice, cellLines, type Lattice, lineStep, voronoiCells } from "./cells";

/**
 * The most cells a pattern may have, about `size²` each over the boundary's
 * bounds, or points of its lines: well past the 10 000 a pattern must stay responsive with (P7), short
 * of what would exhaust a worker's memory.
 */
export const MAX_PATTERN_CELLS = 200_000;

/** Buckets across a block of cells cut together against the region near them (see `cutCells`). */
const BLOCK = 8;

/** Thrown when a pattern's cells are too small for its boundary to generate (see `MAX_PATTERN_CELLS`). */
export class PatternTooDenseError extends RangeError {
  constructor(readonly cells: number) {
    super(`A pattern of about ${Math.round(cells)} cells is too dense`);
    this.name = "PatternTooDenseError";
  }
}

/**
 * A pattern's paths in stock coordinates (PRD-0016 P3, P5, P6, ADR-0087):
 * `settings`' cells tiled from its placement over `boundary`, and cut at it.
 * The boundary's closed paths count even-odd, so counters and inner outlines
 * stay empty, and its open paths are ignored; the pattern stops `inset` inside
 * it. Closed cells, each shrunk by half the gap, become closed paths, those
 * crossing the boundary closed along it; line patterns become open paths
 * ending on it. Empty if nothing lies inside.
 */
export function patternPaths(
  boundary: readonly Path[],
  settings: PatternSettings,
  tolerance = DEFAULT_CHORD_TOLERANCE,
): Path[] {
  const rings = boundary.filter((path) => path.closed).map((path) => flattenPath(path, tolerance));
  if (rings.length === 0) return [];
  // Clean rings, outer boundaries counter-clockwise and holes clockwise, so the
  // even-odd area clips under the default rule from here on.
  const region = offset(rings, -settings.inset, { fillRule: "evenOdd", arcTolerance: tolerance });
  if (region.length === 0) return [];
  const { toStock, toLocal } = placementFrame(settings.placement);
  const local = pointsBounds(region.flat().map(toLocal));
  // Cells, or a line's points, about `size` apart across the rows and `lineStep` along them.
  const estimate =
    ((local.max[0] - local.min[0] + 2 * settings.size) *
      (local.max[1] - local.min[1] + 2 * settings.size)) /
    (settings.size * Math.min(settings.size, lineStep(settings, tolerance)));
  if (estimate > MAX_PATTERN_CELLS) throw new PatternTooDenseError(estimate);

  if (LINE_PATTERN_CELLS.includes(settings.cell)) {
    const lines = (cellLines(settings, local, tolerance) ?? []).map((line) => line.map(toStock));
    // A line lying along an edge would be kept on some edges and not others by
    // the clipper: cut a hair inside, so none is, and lines end that close to it.
    return clipLines(lines, offset(region, -GEOMETRY_TOLERANCE)).flatMap(
      (line) => cleanPath(polygonPath(line, false)) ?? [],
    );
  }

  const lattice = cellLattice(settings, tolerance);
  const halfGap = settings.gap / 2;
  const cells = lattice
    ? tile(insetMotif(lattice, halfGap, tolerance), local)
    : voronoiCells(settings, local).flatMap((cell) => inset([cell], halfGap, tolerance));
  const minArea = tolerance ** 2;
  return cutCells(
    cells.map((cell) => cell.map(toStock)),
    region,
    settings.size,
  ).flatMap((ring) =>
    Math.abs(signedArea(ring)) > minArea ? (cleanPath(polygonPath(ring)) ?? []) : [],
  );
}

/** The maps from a pattern's own frame to stock coordinates and back (ADR-0087). */
function placementFrame(placement: TextPlacement) {
  const {
    position: [px, py],
    rotation,
    mirrored,
  } = placement;
  const angle = (rotation * Math.PI) / 180;
  const [c, s, m] = [Math.cos(angle), Math.sin(angle), mirrored ? -1 : 1];
  return {
    // Rounded as imported coordinates are, as a text item's outlines.
    toStock: textFrame(placement),
    toLocal: ([x, y]: Point): Point => {
      const [dx, dy] = [x - px, y - py];
      return [m * (c * dx + s * dy), -s * dx + c * dy];
    },
  };
}

/** `lattice` with each cell of its motif shrunk by `distance` on its own. */
function insetMotif(lattice: Lattice, distance: number, tolerance: number): Lattice {
  return { ...lattice, motif: lattice.motif.flatMap((cell) => inset([cell], distance, tolerance)) };
}

function inset(cell: Polygon[], distance: number, tolerance: number): Polygon[] {
  return distance > 0 ? offset(cell, -distance, { join: "miter", arcTolerance: tolerance }) : cell;
}

/** The motif's cells at every lattice point where they overlap `bounds`. */
function tile({ a, b, motif }: Lattice, bounds: Rect): Polygon[] {
  if (motif.length === 0) return [];
  const extent = pointsBounds(motif.flat());
  // The translations that bring some of the motif inside the bounds.
  const lo: Point = [bounds.min[0] - extent.max[0], bounds.min[1] - extent.max[1]];
  const hi: Point = [bounds.max[0] - extent.min[0], bounds.max[1] - extent.min[1]];
  const det = a[0] * b[1] - a[1] * b[0];
  const box: Point[] = [lo, hi, [lo[0], hi[1]], [hi[0], lo[1]]];
  const corners = box.map(
    ([x, y]): Point => [(x * b[1] - y * b[0]) / det, (a[0] * y - a[1] * x) / det],
  );
  const is = corners.map(([i]) => i);
  const js = corners.map(([, j]) => j);
  const cells: Polygon[] = [];
  for (let i = Math.floor(Math.min(...is)); i <= Math.ceil(Math.max(...is)); i++) {
    for (let j = Math.floor(Math.min(...js)); j <= Math.ceil(Math.max(...js)); j++) {
      const t: Point = [i * a[0] + j * b[0], i * a[1] + j * b[1]];
      if (t[0] < lo[0] || t[0] > hi[0] || t[1] < lo[1] || t[1] > hi[1]) continue;
      for (const cell of motif) cells.push(cell.map(([x, y]): Point => [x + t[0], y + t[1]]));
    }
  }
  return cells;
}

/**
 * The rings of `cells` inside `region`, each cell cut on its own, outer
 * boundaries counter-clockwise. Cells away from the region's edges are kept
 * or dropped whole, found through a grid of `bucket` squares: those the edges
 * run through, and areas of the others flood-filled inside or outside with one
 * containment test each. Only the cells the boundary crosses go through the
 * clipper.
 */
function cutCells(cells: Polygon[], region: Polygon[], bucket: number): Polygon[] {
  const bounds = pointsBounds(region.flat());
  // A bucket of margin all round holds the edges' neighbours.
  const [ox, oy] = [bounds.min[0] - bucket, bounds.min[1] - bucket];
  const nx = Math.floor((bounds.max[0] - ox) / bucket) + 2;
  const ny = Math.floor((bounds.max[1] - oy) / bucket) + 2;
  const column = (x: number) => Math.floor((x - ox) / bucket);
  const row = (y: number) => Math.floor((y - oy) / bucket);
  const UNKNOWN = 0;
  const INSIDE = 1;
  const OUTSIDE = 2;
  const EDGE = 3;
  const grid = new Uint8Array(nx * ny);
  const mark = (i: number, j: number) => {
    if (i >= 0 && j >= 0 && i < nx && j < ny) grid[i * ny + j] = EDGE;
  };
  for (const ring of region) {
    ring.forEach((p, k) => {
      const q = ring[(k + 1) % ring.length] as Point;
      // Samples half a bucket apart, each marking its bucket's neighbours too,
      // mark every bucket the edge runs through.
      const steps = Math.max(1, Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / (bucket / 2)));
      for (let n = 0; n <= steps; n++) {
        const i = column(p[0] + ((q[0] - p[0]) * n) / steps);
        const j = row(p[1] + ((q[1] - p[1]) * n) / steps);
        for (const di of [-1, 0, 1]) for (const dj of [-1, 0, 1]) mark(i + di, j + dj);
      }
    });
  }
  const contains = region.map(containmentIn);
  /** Whether the bucket at `(i, j)`, which no edge runs through, is inside the region. */
  const inside = (i: number, j: number): boolean => {
    if (i < 0 || j < 0 || i >= nx || j >= ny) return false;
    if (grid[i * ny + j] === UNKNOWN) {
      const center: Point = [ox + (i + 0.5) * bucket, oy + (j + 0.5) * bucket];
      const count = contains.filter((ring) => ring(center) === "inside").length;
      const status = count % 2 === 1 ? INSIDE : OUTSIDE;
      const stack = [i * ny + j];
      grid[i * ny + j] = status;
      for (let at = stack.pop(); at !== undefined; at = stack.pop()) {
        const [ai, aj] = [Math.floor(at / ny), at % ny];
        for (const [bi, bj] of [
          [ai - 1, aj],
          [ai + 1, aj],
          [ai, aj - 1],
          [ai, aj + 1],
        ] as const) {
          if (bi < 0 || bj < 0 || bi >= nx || bj >= ny || grid[bi * ny + bj] !== UNKNOWN) continue;
          grid[bi * ny + bj] = status;
          stack.push(bi * ny + bj);
        }
      }
    }
    return grid[i * ny + j] === INSIDE;
  };

  const kept: Polygon[] = [];
  /** The cells crossing an edge, by block of `BLOCK × BLOCK` buckets, with their bounds. */
  const crossing = new Map<number, { cells: Polygon[][]; bounds: Rect }>();
  for (const cell of cells) {
    const { min, max } = pointsBounds(cell);
    let crosses = false;
    for (let i = column(min[0]); i <= column(max[0]) && !crosses; i++) {
      for (let j = row(min[1]); j <= row(max[1]) && !crosses; j++) {
        crosses = i >= 0 && j >= 0 && i < nx && j < ny && grid[i * ny + j] === EDGE;
      }
    }
    if (crosses) {
      const block = Math.floor(column(min[0]) / BLOCK) * nx + Math.floor(row(min[1]) / BLOCK);
      const group = crossing.get(block);
      if (group) {
        group.cells.push([cell]);
        group.bounds = joinRects(group.bounds, { min, max });
      } else {
        crossing.set(block, { cells: [[cell]], bounds: { min, max } });
      }
    }
    // A mirrored placement turns cells clockwise; the clipper gives the others counter-clockwise.
    else if (inside(column(min[0]), row(min[1])))
      kept.push(signedArea(cell) < 0 ? cell.toReversed() : cell);
  }
  // Each block's cells are cut by only the part of the region round them, so a
  // detailed boundary isn't swept whole for every cell.
  const cut = [...crossing.values()].flatMap(({ cells: group, bounds: near }) =>
    intersectionEach(group, clipToRect(region, near)).flat(),
  );
  return [...kept, ...cut];
}

function pointsBounds(points: readonly Point[]): Rect {
  const min: Point = [Infinity, Infinity];
  const max: Point = [-Infinity, -Infinity];
  for (const [x, y] of points) {
    min[0] = Math.min(min[0], x);
    min[1] = Math.min(min[1], y);
    max[0] = Math.max(max[0], x);
    max[1] = Math.max(max[1], y);
  }
  return { min, max };
}
