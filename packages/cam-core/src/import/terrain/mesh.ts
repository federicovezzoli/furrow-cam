import { MessageError, type Point } from "@furrow/document";
import { signedArea } from "../../geometry/clipper";
import { dropCornerContacts, heightGridMesh, triangleBudget } from "../height-grid";
import type { ImportMessage } from "../messages";
import { type StlLimits, writeBinaryStl } from "../stl/import";
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
  const top = metres.map((h) => (h - low) * scale * settings.exaggeration + settings.base);
  const { positions, indices } = heightGridMesh({
    nx,
    ny,
    cell: [cell * scale, cell * scale],
    inside,
    top,
  });

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
