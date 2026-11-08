import type { LonLat } from "@furrow/cam-core";
import { SEARCH_URL } from "./terrain-services";

/**
 * Finding a place in the terrain dialog (PRD-0014 T2, ADR-0076): coordinates
 * and map links are read here, without sending anything; names go to Photon.
 */

/** Where to move the map: a point and a zoom, or an area to frame (south-west, north-east). */
export type PlaceView =
  | { center: [lon: number, lat: number]; zoom: number }
  | { bounds: [[west: number, south: number], [east: number, north: number]] };

/** A place found: its name (for the model), a label to tell it apart, and where it is. */
export type Place = { name: string; label: string; view: PlaceView };

/** How close the map comes to a point given without a zoom. */
const POINT_ZOOM = 12;

const NUMBER = String.raw`[-+]?\d+(?:\.\d+)?`;

function point(lat: number, lon: number, zoom = POINT_ZOOM): PlaceView | null {
  if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) return null;
  return { center: [lon, lat], zoom: Math.min(18, Math.max(1, zoom)) };
}

/** `46°12'30"N` and the like, as signed degrees; `null` if it isn't one. */
function dms(text: string): { value: number; axis: "lat" | "lon" } | null {
  const match =
    /^(\d+(?:\.\d+)?)\s*°\s*(?:(\d+(?:\.\d+)?)\s*['′]\s*)?(?:(\d+(?:\.\d+)?)\s*(?:["″]|'')\s*)?([NSEWO])$/i.exec(
      text.trim(),
    );
  if (!match) return null;
  const [, d, m = "0", s = "0", hemisphere = ""] = match;
  const value = Number(d) + Number(m) / 60 + Number(s) / 3600;
  const h = hemisphere.toUpperCase();
  return {
    value: h === "S" || h === "W" || h === "O" ? -value : value,
    axis: h === "N" || h === "S" ? "lat" : "lon",
  };
}

/** Numbers with a decimal comma, as most of the interface's languages write them. */
const COMMA_NUMBER = String.raw`[-+]?\d+(?:,\d+)?`;
const commaNumber = (text: string) => Number(text.replace(",", "."));

/**
 * What `text` is, read without sending it anywhere (ADR-0076):
 * - a place to go to: decimal latitude and longitude (`45.92, 9.39`,
 *   `45.92 9.39`, or with decimal commas `45,92 9,39` and `45,92; 9,39`),
 *   degrees with hemispheres (`45°55'N 9°23'E`), a Google Maps link
 *   (`@lat,lng,zoomz`, `?q=lat,lng`) or an OpenStreetMap one
 *   (`#map=z/lat/lng`, `?mlat=&mlon=`);
 * - `shortLink`, a short Google link, which holds no coordinates;
 * - `noCoordinates`, any other link: links are never searched;
 * - `typing`, the start of coordinates, which isn't searched either;
 * - `null`, a name, to be searched.
 */
export function parsePlace(
  text: string,
): PlaceView | "shortLink" | "noCoordinates" | "typing" | null {
  const input = text.trim();
  if (/^(?:https?:\/\/)?(?:maps\.app\.goo\.gl|goo\.gl\/maps)\//i.test(input)) return "shortLink";

  // `45,92` is a number being typed with a decimal comma, not 45 and 92.
  if (/^[-+]?\d+,\d*$/.test(input)) return "typing";
  const decimal = new RegExp(String.raw`^(${NUMBER})\s*[,;\s]\s*(${NUMBER})$`).exec(input);
  // Out of range: still coordinates, not a name to search.
  if (decimal) return point(Number(decimal[1]), Number(decimal[2])) ?? "typing";
  const comma = new RegExp(String.raw`^(${COMMA_NUMBER})\s*(?:;|\s)\s*(${COMMA_NUMBER})$`).exec(
    input,
  );
  if (comma?.[1] && comma[2])
    return point(commaNumber(comma[1]), commaNumber(comma[2])) ?? "typing";

  const halves = /^(.+?[NSEWO])[\s,]+(.+[NSEWO])$/i.exec(input);
  if (halves?.[1] && halves[2]) {
    const a = dms(halves[1]);
    const b = dms(halves[2]);
    if (a && b && a.axis !== b.axis) {
      const [lat, lon] = a.axis === "lat" ? [a.value, b.value] : [b.value, a.value];
      return point(lat, lon) ?? "typing";
    }
  }

  // Digits, signs, separators and degree marks: coordinates on their way, never searched.
  if (/^[-+\d.,;:°'′"″\s]*[NSEWO]?[-+\d.,;:°'′"″\s]*$/i.test(input) && /\d/.test(input))
    return "typing";
  // A scheme, or a host with a dot followed by a path: a link, even one this can't read.
  if (!/^[a-z][\w+.-]*:\/\/|^[\w-]+(?:\.[\w-]+)+\//i.test(input)) return null;
  let url: URL;
  try {
    url = new URL(/^[a-z][\w+.-]*:\/\//i.test(input) ? input : `https://${input}`);
  } catch {
    return "noCoordinates";
  }
  const host = url.hostname.replace(/^www\./, "");
  if (/^(?:maps\.)?google\.[a-z.]+$/.test(host)) {
    const at = new RegExp(String.raw`@(${NUMBER}),(${NUMBER})(?:,(\d+(?:\.\d+)?)z)?`).exec(
      url.pathname,
    );
    if (at)
      return (
        point(Number(at[1]), Number(at[2]), at[3] ? Number(at[3]) : undefined) ?? "noCoordinates"
      );
    const query = new RegExp(String.raw`^(${NUMBER}),\s*(${NUMBER})$`).exec(
      url.searchParams.get("q") ?? url.searchParams.get("ll") ?? "",
    );
    if (query) return point(Number(query[1]), Number(query[2])) ?? "noCoordinates";
  }
  if (host === "openstreetmap.org" || host.endsWith(".openstreetmap.org")) {
    const map = new RegExp(String.raw`map=(\d+(?:\.\d+)?)/(${NUMBER})/(${NUMBER})`).exec(url.hash);
    const zoom = map ? Number(map[1]) : undefined;
    // A marker is the place meant; the map's view may be off to one side of it.
    const mlat = url.searchParams.get("mlat");
    const mlon = url.searchParams.get("mlon");
    if (mlat && mlon) return point(Number(mlat), Number(mlon), zoom) ?? "noCoordinates";
    if (map) return point(Number(map[2]), Number(map[3]), zoom) ?? "noCoordinates";
  }
  return "noCoordinates";
}

/** Photon names places in these languages only, and refuses any other with a 400 (ADR-0076). */
const SEARCH_LANGUAGES = new Set(["en", "de", "fr"]);

/** Search is down or throttling us: the dialog points to coordinates and links instead. */
export class SearchUnavailableError extends Error {}

type PhotonFeature = {
  geometry?: { type?: string; coordinates?: number[] };
  properties?: Record<string, unknown> & { extent?: number[] };
};

const text = (value: unknown) => (typeof value === "string" && value !== "" ? value : null);

/**
 * Up to 5 places whose name matches `query`, named in `locale` when Photon
 * has it and by their local names otherwise. Throws `SearchUnavailableError`
 * when Photon can't answer (offline, 429, 503 or anything else), or an
 * `AbortError` once `signal` aborts.
 */
export async function searchPlaces(
  query: string,
  locale: string,
  signal?: AbortSignal,
): Promise<Place[]> {
  const url = new URL(SEARCH_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "5");
  const language = locale.slice(0, 2);
  if (SEARCH_LANGUAGES.has(language)) url.searchParams.set("lang", language);
  let response: Response;
  try {
    response = await fetch(url, { signal });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new SearchUnavailableError();
  }
  if (!response.ok) throw new SearchUnavailableError();
  const body = (await response.json().catch((error) => {
    if (signal?.aborted) throw error;
    return null;
  })) as { features?: unknown } | null;
  if (!Array.isArray(body?.features)) throw new SearchUnavailableError();
  const places: Place[] = [];
  for (const { geometry, properties = {} } of body.features as PhotonFeature[]) {
    const [lon, lat] = geometry?.coordinates ?? [];
    const name = text(properties.name) ?? text(properties.city) ?? text(properties.country);
    if (typeof lon !== "number" || typeof lat !== "number" || !name) continue;
    const label = [properties.city, properties.state, properties.country]
      .map(text)
      .filter((part): part is string => part !== null && part !== name)
      .join(", ");
    const extent = properties.extent;
    // An extent across the 180° meridian (west past east) would frame the rest of the world.
    const view: PlaceView | null =
      extent?.length === 4 &&
      extent.every(Number.isFinite) &&
      (extent[0] as number) <= (extent[2] as number)
        ? {
            bounds: [
              [extent[0] as number, extent[3] as number],
              [extent[2] as number, extent[1] as number],
            ],
          }
        : point(lat, lon);
    if (view) places.push({ name, label, view });
  }
  return places;
}

/** The longest file name, before `.stl`, taken from a place. */
const MAX_FILE_NAME = 100;

/**
 * `name` as a file name every system takes: without the characters and
 * control codes they refuse, trailing dots, or a name Windows reserves
 * (`NUL`, `COM1`…), at most 100 characters; empty if nothing is left.
 */
export function fileNameFor(name: string): string {
  const cleaned = name
    // biome-ignore lint/suspicious/noControlCharactersInRegex: control codes are what is removed.
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, MAX_FILE_NAME)
    .replace(/[\s.]+$/, "")
    .trim();
  return /^(?:con|prn|aux|nul|com\d|lpt\d)$/i.test(cleaned) ? "" : cleaned;
}

/**
 * The name of the place picked if the area drawn is about it: its point, or
 * its area's centre, within the area's box widened by half on each side.
 * An area drawn elsewhere after moving the map isn't named after it.
 */
export function areaName(
  place: { name: string | null; view: PlaceView } | null,
  ring: readonly LonLat[],
): string | null {
  if (!place?.name || ring.length === 0) return null;
  const [x, y] =
    "center" in place.view
      ? place.view.center
      : [
          (place.view.bounds[0][0] + place.view.bounds[1][0]) / 2,
          (place.view.bounds[0][1] + place.view.bounds[1][1]) / 2,
        ];
  const xs = ring.map(([lon]) => lon);
  const ys = ring.map(([, lat]) => lat);
  const [west, east, south, north] = [
    Math.min(...xs),
    Math.max(...xs),
    Math.min(...ys),
    Math.max(...ys),
  ];
  const [dx, dy] = [(east - west) / 2, (north - south) / 2];
  const near = x >= west - dx && x <= east + dx && y >= south - dy && y <= north + dy;
  return near ? place.name : null;
}
