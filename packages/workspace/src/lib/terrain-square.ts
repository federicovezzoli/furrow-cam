import type { LonLat } from "@furrow/cam-core";

/** The mean Earth radius, in metres, as the terrain's local projection uses (ADR-0077). */
const EARTH_RADIUS = 6_371_008.8;
const DEGREE = Math.PI / 180;
/** Web Mercator's tiles, the map's and the elevation's, end here. */
const MAX_LATITUDE = 85;
const clamp = (value: number, limit: number) => Math.min(limit, Math.max(-limit, value));

/**
 * The square on the ground dragged from `start` towards `end` (PRD-0014 T3):
 * its side is the longer of the drag's two distances in metres, on the side
 * of `start` the drag went. Its corners, not repeating the first. It stops
 * at the map's edges (±180° longitude, ±85° latitude, where its tiles end),
 * so a drag past them gives a shorter side there rather than coordinates the
 * tiles don't cover.
 */
export function squareRing(start: LonLat, end: LonLat): LonLat[] {
  const [lon0, lat0] = start;
  const metresPerLat = EARTH_RADIUS * DEGREE;
  const lonScale = (lat: number) => EARTH_RADIUS * DEGREE * Math.cos(lat * DEGREE);
  const dy = (end[1] - lat0) * metresPerLat;
  const dx = (end[0] - lon0) * lonScale((lat0 + end[1]) / 2);
  const side = Math.max(Math.abs(dx), Math.abs(dy));
  const lat1 = clamp(lat0 + (Math.sign(dy) || 1) * (side / metresPerLat), MAX_LATITUDE);
  // East-west at the square's middle latitude, as the terrain's projection measures it.
  const lon1 = clamp(lon0 + (Math.sign(dx) || 1) * (side / lonScale((lat0 + lat1) / 2)), 180);
  return [
    [lon0, lat0],
    [lon1, lat0],
    [lon1, lat1],
    [lon0, lat1],
  ];
}

/**
 * `ring` moved by a drag from `from` to `to`, keeping its size on the ground:
 * its centre moves by the drag, and its east-west extent is rescaled to the
 * new latitude, where a degree of longitude is shorter or longer.
 */
export function moveRing(ring: readonly LonLat[], from: LonLat, to: LonLat): LonLat[] {
  const lons = ring.map(([lon]) => lon);
  const lats = ring.map(([, lat]) => lat);
  const lon0 = (Math.min(...lons) + Math.max(...lons)) / 2;
  const lat0 = (Math.min(...lats) + Math.max(...lats)) / 2;
  const lon1 = lon0 + to[0] - from[0];
  const lat1 = clamp(lat0 + to[1] - from[1], MAX_LATITUDE);
  const stretch = Math.cos(lat0 * DEGREE) / Math.cos(lat1 * DEGREE);
  // Like the square, it stops at the map's edges, where the tiles end.
  return ring.map(([lon, lat]) => [
    clamp(lon1 + (lon - lon0) * stretch, 180),
    clamp(lat1 + (lat - lat0), MAX_LATITUDE),
  ]);
}
