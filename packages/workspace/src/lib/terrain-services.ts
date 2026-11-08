import type { TileKey } from "@furrow/cam-core";

/**
 * The public services *Terrain from a map* calls from the browser (ADR-0076),
 * in one place so a fork can point them at its own instances and the desktop
 * app can let exactly these through. Plain module: the desktop main process
 * imports it too.
 * shortcut: build-time constants; make them instance settings if anyone asks.
 */

/** OpenFreeMap's `liberty` style: the base map, OpenStreetMap data. */
export const MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

/** Mapterhorn's Terrarium-encoded elevation tiles. */
export function elevationTileUrl({ z, x, y }: TileKey): string {
  return `https://tiles.mapterhorn.com/${z}/${x}/${y}.webp`;
}

/** The deepest zoom Mapterhorn serves anywhere (regional lidar); most places stop earlier. */
export const MAX_ELEVATION_ZOOM = 17;

/** The elevation data's credit, beside the map's own (OpenStreetMap, OpenFreeMap). */
export const ELEVATION_ATTRIBUTION =
  '<a href="https://mapterhorn.com/attribution" target="_blank" rel="noopener noreferrer">© Mapterhorn</a>';

/** The hosts the feature contacts, for the desktop app's request filter and CSP (#507). */
export const TERRAIN_HOSTS = ["tiles.openfreemap.org", "tiles.mapterhorn.com"] as const;
