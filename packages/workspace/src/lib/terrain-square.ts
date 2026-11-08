import type { LonLat } from "@furrow/cam-core";

/** The mean Earth radius, in metres, as the terrain's local projection uses (ADR-0077). */
const EARTH_RADIUS = 6_371_008.8;
const DEGREE = Math.PI / 180;

/**
 * The square on the ground dragged from `start` towards `end` (PRD-0014 T3):
 * its side is the longer of the drag's two distances in metres, on the side
 * of `start` the drag went. Its corners, not repeating the first.
 */
export function squareRing(start: LonLat, end: LonLat): LonLat[] {
  const [lon0, lat0] = start;
  const metresPerLat = EARTH_RADIUS * DEGREE;
  const lonScale = (lat: number) => EARTH_RADIUS * DEGREE * Math.cos(lat * DEGREE);
  const dy = (end[1] - lat0) * metresPerLat;
  const dx = (end[0] - lon0) * lonScale((lat0 + end[1]) / 2);
  const side = Math.max(Math.abs(dx), Math.abs(dy));
  const lat1 = lat0 + (Math.sign(dy) || 1) * (side / metresPerLat);
  // East-west at the square's middle latitude, as the terrain's projection measures it.
  const lon1 = lon0 + (Math.sign(dx) || 1) * (side / lonScale((lat0 + lat1) / 2));
  return [
    [lon0, lat0],
    [lon1, lat0],
    [lon1, lat1],
    [lon0, lat1],
  ];
}
