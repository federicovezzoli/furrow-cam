import { MessageError, type Point } from "@furrow/document";
import { containmentIn, signedArea } from "../../geometry/clipper";
import { triangulate } from "../../geometry/triangulate";
import type { ImportMessage } from "../messages";
import { binaryStlTriangles, type StlLimits, writeBinaryStl } from "../stl/import";
import {
  elevationSampler,
  type LonLat,
  type TerrainTile,
  type TileKey,
  terrainZoom,
  tilesCovering,
} from "./tiles";

// Terrain from an area on a map, as a closed mesh (PRD-0014, ADR-0077).

/** Why a terrain can't be made, for the user (ADR-0054). */
export class TerrainError extends MessageError<ImportMessage> {}

/** The widest area a terrain may cover, in metres (PRD-0014 non-goals). */
export const MAX_TERRAIN_SPAN = 200_000;

/** The model's size and relief, chosen by the user (PRD-0014 T4). */
export type TerrainSettings = {
  /** The model's longest side, in mm. */
  longestSide: number;
  /** How much taller than true scale the relief is. */
  exaggeration: number;
  /** The model's thickness under its lowest point, in mm. */
  base: number;
};

/** The exaggeration's range and default (PRD-0014 T4). */
export const TERRAIN_EXAGGERATION = { min: 1, max: 10, initial: 1.5 };
/** The base's smallest value and default, in mm (PRD-0014 T4). */
export const TERRAIN_BASE = { min: 1, initial: 3 };

/** What a terrain needs before its heights are fetched. */
export type TerrainPlan = {
  /** The area's width and depth on the ground, in metres. */
  span: [number, number];
  /** Cells along the area's longest side. */
  cells: number;
  /** A cell's side on the ground, in metres. */
  cellMetres: number;
  /** The tiles to fetch, all at one zoom; a missing one may be replaced by its parent. */
  tiles: TileKey[];
  /** The most triangles the mesh may have, from the STL limits. */
  maxTriangles: number;
};

/** A terrain model: a closed binary STL in mm, its lowest corner at (0, 0, 0). */
export type Terrain = {
  stl: Uint8Array<ArrayBuffer>;
  triangles: number;
  /** Width, depth and height, in mm. */
  size: [number, number, number];
  /** The area's lowest and highest heights, in metres. */
  heights: [number, number];
  /** A cell's side on the ground, in metres: coarser than planned if the limits demanded it. */
  cellMetres: number;
  /** The area's own outline in the model's mm (not the cells' staircase), for a profile cut (T7). */
  // shortcut: unread while the outline drawing is set aside (PRD-0014 T7, #526); drop it if T7 is dropped.
  outline: Point[];
};

/** The mean Earth radius, in metres. */
const EARTH_RADIUS = 6_371_008.8;
const DEGREE = Math.PI / 180;

/**
 * The area `ring` (longitude and latitude in degrees, not repeating its first
 * point) in metres on a local projection about its centre, with its bounds.
 */
function localArea(ring: readonly LonLat[]) {
  if (ring.length < 3) throw new TerrainError({ code: "terrain.noArea" });
  const [lonMin, latMin, lonMax, latMax] = bounds(ring);
  // shortcut: areas across the 180° meridian are refused (PRD-0014 non-goals); unwrap longitudes about the first point to allow them.
  if (lonMax - lonMin > 180) throw new TerrainError({ code: "terrain.antimeridian" });
  const lon0 = (lonMin + lonMax) / 2;
  const lat0 = (latMin + latMax) / 2;
  const kx = EARTH_RADIUS * DEGREE * Math.cos(lat0 * DEGREE);
  const ky = EARTH_RADIUS * DEGREE;
  const local = ring.map(([lon, lat]): Point => [(lon - lon0) * kx, (lat - lat0) * ky]);
  const [xMin, yMin, xMax, yMax] = bounds(local);
  const min: Point = [xMin, yMin];
  const max: Point = [xMax, yMax];
  // Grid corners past the area's edge are read at its edge, so the tiles covering it are enough.
  const toLonLat = ([x, y]: Point): LonLat => [
    lon0 + Math.min(xMax, Math.max(xMin, x)) / kx,
    lat0 + Math.min(yMax, Math.max(yMin, y)) / ky,
  ];
  return { local, min, max, lat0, toLonLat };
}

/** The smallest and largest of each coordinate, without spreading them into arguments. */
function bounds(points: readonly (readonly [number, number])[]): [number, number, number, number] {
  let [xMin, yMin, xMax, yMax] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of points) {
    xMin = Math.min(xMin, x);
    yMin = Math.min(yMin, y);
    xMax = Math.max(xMax, x);
    yMax = Math.max(yMax, y);
  }
  return [xMin, yMin, xMax, yMax];
}

type Area = ReturnType<typeof localArea>;

/** The most triangles `limits` let a binary STL hold. */
function triangleBudget(limits: StlLimits): number {
  return Math.min(limits.maxTriangles, binaryStlTriangles(limits.maxBytes));
}

/**
 * Cells along the longest side, the most whose mesh is expected within
 * `budget`: two triangles per cell inside the area, plus walls and bottom
 * along its staircase outline.
 */
function plannedCells(area: Area, budget: number): number {
  const width = area.max[0] - area.min[0];
  const depth = area.max[1] - area.min[1];
  const longest = Math.max(width, depth);
  let manhattan = 0;
  area.local.forEach(([x, y], i) => {
    const [nx, ny] = area.local[(i + 1) % area.local.length] as Point;
    manhattan += Math.abs(nx - x) + Math.abs(ny - y);
  });
  const fill = Math.abs(signedArea(area.local)) / (width * depth);
  const estimate = (n: number) => {
    const cell = longest / n;
    return 2 * fill * Math.ceil(width / cell) * Math.ceil(depth / cell) + (4 * manhattan) / cell;
  };
  let low = 1;
  let high = 4096;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (estimate(mid) <= budget) low = mid;
    else high = mid - 1;
  }
  return low;
}

/** The grid of `n` cells along the area's longest side. */
function gridFor(area: Area, n: number) {
  const width = area.max[0] - area.min[0];
  const depth = area.max[1] - area.min[1];
  const cell = Math.max(width, depth) / n;
  return {
    cell,
    nx: Math.max(1, Math.ceil(width / cell - 1e-9)),
    ny: Math.max(1, Math.ceil(depth / cell - 1e-9)),
  };
}

/**
 * What to fetch for the area `ring` within `limits`: the detail and the tiles
 * at the lowest zoom up to `maxZoom` that gives it. Throws for an area that
 * is degenerate or wider than `MAX_TERRAIN_SPAN`.
 */
export function planTerrain(
  ring: readonly LonLat[],
  limits: StlLimits,
  maxZoom: number,
): TerrainPlan {
  const area = localArea(ring);
  const span: [number, number] = [area.max[0] - area.min[0], area.max[1] - area.min[1]];
  if (!(span[0] > 0 && span[1] > 0)) throw new TerrainError({ code: "terrain.noArea" });
  if (Math.max(...span) > MAX_TERRAIN_SPAN)
    throw new TerrainError({ code: "terrain.tooWide", values: { km: MAX_TERRAIN_SPAN / 1000 } });
  const maxTriangles = triangleBudget(limits);
  const cells = plannedCells(area, maxTriangles);
  const { cell } = gridFor(area, cells);
  const zoom = terrainZoom(area.lat0, cell, maxZoom);
  const tiles = tilesCovering(area.toLonLat(area.min), area.toLonLat(area.max), zoom);
  return { span, cells, cellMetres: cell, tiles, maxTriangles };
}

/**
 * The terrain of the area `ring` as a closed mesh (ADR-0077), on the grid
 * `plan` chose for it, from the heights in `tiles` (those of the plan), and
 * sized by `settings`. Throws where no tile covers a point of the area, or if
 * the area holds no cell.
 */
export function terrainMesh(
  ring: readonly LonLat[],
  plan: TerrainPlan,
  settings: TerrainSettings,
  tiles: readonly TerrainTile[],
): Terrain {
  const area = localArea(ring);
  const heightAt = elevationSampler(tiles);
  let n = plan.cells;
  // The plan estimates the outline's cost; a ragged one can cost more, so the grid shrinks until it fits.
  for (let attempt = 0; attempt < 8; attempt++) {
    const built = buildTerrain(area, gridFor(area, n), settings, heightAt);
    const triangles = built.indices.length / 3;
    if (triangles <= plan.maxTriangles) return finish(built);
    n = Math.max(1, Math.floor(n * Math.sqrt(plan.maxTriangles / triangles)) - 1);
  }
  throw new TerrainError({ code: "terrain.tooDetailed" });
}

/**
 * Moves the mesh so its lowest corner is at the origin, its outline with it,
 * and writes it out.
 */
function finish({
  positions,
  indices,
  outline,
  heights,
  cellMetres,
}: ReturnType<typeof buildTerrain>): Terrain {
  let [xMin, yMin, xMax, yMax, zMax] = [Infinity, Infinity, -Infinity, -Infinity, 0];
  for (let k = 0; k < positions.length; k += 3) {
    xMin = Math.min(xMin, positions[k] as number);
    yMin = Math.min(yMin, positions[k + 1] as number);
    xMax = Math.max(xMax, positions[k] as number);
    yMax = Math.max(yMax, positions[k + 1] as number);
    zMax = Math.max(zMax, positions[k + 2] as number);
  }
  for (let k = 0; k < positions.length; k += 3) {
    positions[k] = (positions[k] as number) - xMin;
    positions[k + 1] = (positions[k + 1] as number) - yMin;
  }
  return {
    stl: writeBinaryStl([{ positions, indices }]),
    triangles: indices.length / 3,
    size: [xMax - xMin, yMax - yMin, zMax],
    heights,
    cellMetres,
    outline: outline.map(([x, y]): Point => [x - xMin, y - yMin]),
  };
}

/** The mesh's vertices and triangles on one grid, in mm from the grid's corner. */
function buildTerrain(
  area: Area,
  { cell, nx, ny }: ReturnType<typeof gridFor>,
  settings: TerrainSettings,
  heightAt: (place: LonLat) => number,
) {
  const inside = cellsInside(area, cell, nx, ny);
  dropCornerContacts(inside, nx, ny);
  const columns = nx + 1;
  const vertex = (i: number, j: number) => j * columns + i;
  const at = (i: number, j: number) =>
    i >= 0 && j >= 0 && i < nx && j < ny && inside[j * nx + i] === 1;

  // Heights at the corners of every cell inside.
  const metres = new Float64Array(columns * (ny + 1)).fill(Number.NaN);
  let low = Number.POSITIVE_INFINITY;
  let high = Number.NEGATIVE_INFINITY;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      if (!at(i, j)) continue;
      for (const [ci, cj] of [
        [i, j],
        [i + 1, j],
        [i, j + 1],
        [i + 1, j + 1],
      ] as const) {
        const v = vertex(ci, cj);
        if (!Number.isNaN(metres[v] as number)) continue;
        const h = heightAt(area.toLonLat([area.min[0] + ci * cell, area.min[1] + cj * cell]));
        if (Number.isNaN(h)) throw new TerrainError({ code: "terrain.noData" });
        metres[v] = h;
        low = Math.min(low, h);
        high = Math.max(high, h);
      }
    }
  }
  if (low > high) throw new TerrainError({ code: "terrain.noArea" });

  const longest = Math.max(area.max[0] - area.min[0], area.max[1] - area.min[1]);
  const scale = settings.longestSide / longest;
  const positions: number[] = [];
  const indices: number[] = [];
  const add = (x: number, y: number, z: number) => {
    positions.push(x, y, z);
    return positions.length / 3 - 1;
  };
  const xy = (v: number): Point => [
    (v % columns) * cell * scale,
    Math.floor(v / columns) * cell * scale,
  ];

  const top = new Int32Array(metres.length).fill(-1);
  metres.forEach((h, v) => {
    if (!Number.isNaN(h)) {
      const [x, y] = xy(v);
      top[v] = add(x, y, (h - low) * scale * settings.exaggeration + settings.base);
    }
  });
  const t = (v: number) => top[v] as number;

  // The top: two triangles per cell, counter-clockwise from above. The
  // outline: each side of a cell inside with no cell beyond, the inside on
  // its left, so outer loops run counter-clockwise and holes clockwise.
  const next = new Int32Array(metres.length).fill(-1);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      if (!at(i, j)) continue;
      const a = vertex(i, j);
      const b = vertex(i + 1, j);
      const c = vertex(i + 1, j + 1);
      const d = vertex(i, j + 1);
      indices.push(t(a), t(b), t(c), t(a), t(c), t(d));
      if (!at(i, j - 1)) next[a] = b;
      if (!at(i + 1, j)) next[b] = c;
      if (!at(i, j + 1)) next[c] = d;
      if (!at(i - 1, j)) next[d] = a;
    }
  }

  // The walls, facing out, down to a bottom vertex under each outline vertex.
  const bottom = new Int32Array(metres.length).fill(-1);
  next.forEach((to, v) => {
    if (to >= 0) bottom[v] = add(...xy(v), 0);
  });
  const b = (v: number) => bottom[v] as number;
  next.forEach((q, p) => {
    if (q >= 0) indices.push(b(p), b(q), t(q), b(p), t(q), t(p));
  });

  addBottom(outlineLoops(next), columns, xy, add, b, indices);

  const outline = area.local.map(
    ([x, y]): Point => [(x - area.min[0]) * scale, (y - area.min[1]) * scale],
  );
  return {
    positions,
    indices,
    outline,
    heights: [low, high] as [number, number],
    cellMetres: cell,
  };
}

/** Which cells have their centre inside the area, by scanning each row (even-odd). */
function cellsInside(area: Area, cell: number, nx: number, ny: number): Uint8Array {
  const inside = new Uint8Array(nx * ny);
  const { local, min } = area;
  for (let j = 0; j < ny; j++) {
    const y = min[1] + (j + 0.5) * cell;
    const crossings: number[] = [];
    local.forEach(([px, py], k) => {
      const [qx, qy] = local[(k + 1) % local.length] as Point;
      if (py <= y !== qy <= y) crossings.push(px + ((y - py) * (qx - px)) / (qy - py));
    });
    crossings.sort((p, q) => p - q);
    for (let k = 0; k + 1 < crossings.length; k += 2) {
      const first = Math.max(0, Math.ceil(((crossings[k] as number) - min[0]) / cell - 0.5));
      const end = Math.min(nx, Math.ceil(((crossings[k + 1] as number) - min[0]) / cell - 0.5));
      for (let i = first; i < end; i++) inside[j * nx + i] = 1;
    }
  }
  return inside;
}

/**
 * Drops cells that touch the rest only at a corner, so every outline vertex
 * has one side in and one out and every edge of the mesh joins two faces.
 * Of the two diagonal cells, the one with fewer neighbours goes.
 */
function dropCornerContacts(inside: Uint8Array, nx: number, ny: number) {
  const at = (i: number, j: number) =>
    i >= 0 && j >= 0 && i < nx && j < ny && inside[j * nx + i] === 1;
  const neighbours = (i: number, j: number) =>
    Number(at(i - 1, j)) + Number(at(i + 1, j)) + Number(at(i, j - 1)) + Number(at(i, j + 1));
  const drop = (p: [number, number], q: [number, number]) => {
    const [i, j] = neighbours(...p) <= neighbours(...q) ? p : q;
    inside[j * nx + i] = 0;
  };
  let changed = true;
  while (changed) {
    changed = false;
    for (let j = 0; j + 1 < ny; j++) {
      for (let i = 0; i + 1 < nx; i++) {
        const a = at(i, j);
        const b = at(i + 1, j);
        const c = at(i, j + 1);
        const d = at(i + 1, j + 1);
        if (a && d && !b && !c) drop([i, j], [i + 1, j + 1]);
        else if (b && c && !a && !d) drop([i + 1, j], [i, j + 1]);
        else continue;
        changed = true;
      }
    }
  }
}

/** The outline's loops of vertices, each in the order `next` links them. */
function outlineLoops(next: Int32Array): number[][] {
  const seen = new Uint8Array(next.length);
  const loops: number[][] = [];
  next.forEach((to, start) => {
    if (to < 0 || seen[start]) return;
    const loop: number[] = [];
    for (let v = start; !seen[v]; v = next[v] as number) {
      seen[v] = 1;
      loop.push(v);
    }
    loops.push(loop);
  });
  return loops;
}

/**
 * The flat bottom, facing down. Each outer loop and the holes inside it are
 * triangulated by their corners only; where a triangle's side runs along the
 * outline past other outline vertices, it is split around its centroid so it
 * shares every one of them with the walls.
 */
function addBottom(
  loops: number[][],
  columns: number,
  xy: (v: number) => Point,
  add: (x: number, y: number, z: number) => number,
  b: (v: number) => number,
  indices: number[],
) {
  const grid = (v: number): Point => [v % columns, Math.floor(v / columns)];
  const along = new Map<string, number[]>();
  const shapes = loops.map((loop) => {
    const corners = loop.filter((v, k) => {
      const [px, py] = grid(loop[(k + loop.length - 1) % loop.length] as number);
      const [x, y] = grid(v);
      const [qx, qy] = grid(loop[(k + 1) % loop.length] as number);
      return (x - px) * (qy - y) - (y - py) * (qx - x) !== 0;
    });
    // The outline vertices between each pair of consecutive corners, both ways.
    let k = loop.indexOf(corners[0] as number);
    corners.forEach((from, c) => {
      const to = corners[(c + 1) % corners.length] as number;
      const between: number[] = [];
      for (k = (k + 1) % loop.length; loop[k] !== to; k = (k + 1) % loop.length)
        between.push(loop[k] as number);
      along.set(`${from},${to}`, between);
      along.set(`${to},${from}`, [...between].reverse());
    });
    const points = corners.map(grid);
    return { corners, points, area: signedArea(points), contains: containmentIn(points) };
  });

  const outers = shapes.filter((shape) => shape.area > 0);
  const holesOf = new Map(outers.map((outer) => [outer, [] as typeof shapes]));
  for (const hole of shapes.filter((shape) => shape.area < 0)) {
    const point = hole.points[0] as Point;
    const around = outers
      .filter((outer) => outer.contains(point) === "inside")
      .sort((p, q) => p.area - q.area)[0];
    if (around) holesOf.get(around)?.push(hole);
  }

  for (const [outer, holes] of holesOf) {
    const vertices = [outer, ...holes].flatMap((shape) => shape.corners);
    const triangles = triangulate(
      outer.points,
      holes.map((hole) => hole.points),
    );
    for (let k = 0; k < triangles.length; k += 3) {
      let corner = [0, 1, 2].map((m) => vertices[triangles[k + m] as number] as number);
      // Clockwise from above, so the bottom faces down.
      if (signedArea(corner.map(grid)) > 0) corner = [corner[0], corner[2], corner[1]] as number[];
      const ring = corner.flatMap((v, m) => [
        v,
        ...(along.get(`${v},${corner[(m + 1) % 3]}`) ?? []),
      ]);
      if (ring.length === 3) {
        indices.push(b(ring[0] as number), b(ring[1] as number), b(ring[2] as number));
        continue;
      }
      const [cx, cy] = corner
        .map(xy)
        .reduce(([sx, sy], [x, y]) => [sx + x / 3, sy + y / 3], [0, 0]);
      const centre = add(cx, cy, 0);
      ring.forEach((v, m) => {
        indices.push(centre, b(v), b(ring[(m + 1) % ring.length] as number));
      });
    }
  }
}
