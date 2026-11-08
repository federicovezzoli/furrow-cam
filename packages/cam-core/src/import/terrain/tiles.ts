// Elevation tiles in Web Mercator (ADR-0076, ADR-0077): which tiles cover an
// area, how their pixels decode to heights, and the height at a place.

/** A place: longitude and latitude in degrees. */
export type LonLat = readonly [lon: number, lat: number];

/** A tile's address: zoom, column and row (XYZ scheme, row 0 at the north). */
export type TileKey = { z: number; x: number; y: number };

/** A tile's heights in metres, row by row from its north-west corner; square. */
export type TerrainTile = TileKey & { heights: Float32Array };

/** Mapterhorn's tiles are 512 pixels wide. */
export const TERRAIN_TILE_SIZE = 512;

/** Web Mercator's equator, in metres. */
const EQUATOR = 2 * Math.PI * 6_378_137;

/**
 * Heights in metres from a Terrarium-encoded tile's RGBA pixels:
 * `R × 256 + G + B / 256 − 32768`.
 */
export function decodeTerrarium(rgba: ArrayLike<number>): Float32Array {
  const heights = new Float32Array(rgba.length / 4);
  for (let i = 0; i < heights.length; i++) {
    const r = rgba[i * 4] as number;
    const g = rgba[i * 4 + 1] as number;
    const b = rgba[i * 4 + 2] as number;
    heights[i] = r * 256 + g + b / 256 - 32768;
  }
  return heights;
}

/** A place on the Web Mercator square, from (0, 0) at its north-west corner to (1, 1). */
function mercator([lon, lat]: LonLat): [number, number] {
  const phi = (lat * Math.PI) / 180;
  return [(lon + 180) / 360, (1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2];
}

/**
 * The lowest zoom, up to `maxZoom`, whose pixels at `latitude` are no larger
 * than `cellMetres`.
 */
export function terrainZoom(latitude: number, cellMetres: number, maxZoom: number): number {
  const pixelAtZero = (EQUATOR * Math.cos((latitude * Math.PI) / 180)) / TERRAIN_TILE_SIZE;
  const zoom = Math.ceil(Math.log2(pixelAtZero / cellMetres));
  return Math.min(maxZoom, Math.max(0, zoom));
}

/** The tiles at `zoom` covering the box from `min` (south-west) to `max` (north-east). */
export function tilesCovering(min: LonLat, max: LonLat, zoom: number): TileKey[] {
  const count = 2 ** zoom;
  const index = (value: number) => Math.min(count - 1, Math.max(0, Math.floor(value * count)));
  const [west, north] = mercator([min[0], max[1]]);
  const [east, south] = mercator([max[0], min[1]]);
  const tiles: TileKey[] = [];
  for (let y = index(north); y <= index(south); y++) {
    for (let x = index(west); x <= index(east); x++) tiles.push({ z: zoom, x, y });
  }
  return tiles;
}

/**
 * The height in metres at a place, interpolated between the pixels of the
 * deepest tile in `tiles` that covers it: a tile missing at one zoom (no
 * regional data) falls back to its parent. `NaN` where no tile covers it.
 */
export function elevationSampler(tiles: readonly TerrainTile[]): (place: LonLat) => number {
  const byKey = new Map(tiles.map((tile) => [`${tile.z}/${tile.x}/${tile.y}`, tile]));
  const deepest = Math.max(-1, ...tiles.map((tile) => tile.z));
  return (place) => {
    const [mx, my] = mercator(place);
    for (let z = deepest; z >= 0; z--) {
      const count = 2 ** z;
      const x = Math.floor(mx * count);
      const y = Math.floor(my * count);
      const tile = byKey.get(`${z}/${x}/${y}`);
      if (!tile) continue;
      const size = Math.sqrt(tile.heights.length);
      // Pixel centres sit half a pixel in.
      return bilinear(
        tile.heights,
        size,
        (mx * count - x) * size - 0.5,
        (my * count - y) * size - 0.5,
      );
    }
    return Number.NaN;
  };
}

/** `heights` (a `size` × `size` grid) at the fractional pixel `(u, v)`, clamped to its edges. */
function bilinear(heights: Float32Array, size: number, u: number, v: number): number {
  const clamp = (value: number) => Math.min(size - 1, Math.max(0, value));
  const cu = clamp(u);
  const cv = clamp(v);
  const u0 = Math.floor(cu);
  const v0 = Math.floor(cv);
  const u1 = Math.min(size - 1, u0 + 1);
  const v1 = Math.min(size - 1, v0 + 1);
  const fu = cu - u0;
  const fv = cv - v0;
  const at = (i: number, j: number) => heights[j * size + i] as number;
  const top = at(u0, v0) * (1 - fu) + at(u1, v0) * fu;
  const bottom = at(u0, v1) * (1 - fu) + at(u1, v1) * fu;
  return top * (1 - fv) + bottom * fv;
}
