import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { isAbsolute } from "node:path";
import {
  type Box3,
  DEFAULT_STL_LIMITS,
  type LonLat,
  planTerrain,
  type StlLimits,
  type TerrainSettings,
  terrainMesh,
} from "@furrow/cam-core";
import { MessageError } from "@furrow/document";
import { fittingSide } from "@furrow/workspace/lib/model-size";
import { fileNameFor, parsePlace } from "@furrow/workspace/lib/place-search";
import { MAX_ELEVATION_ZOOM } from "@furrow/workspace/lib/terrain-services";
import { fetchElevationTile, loadTerrainTiles } from "@furrow/workspace/lib/terrain-tiles";
import { canImportModel, ONE_MODEL } from "@furrow/workspace/stores/geometry-actions";
import { addMesh, text } from "./drawings-and-models";
import { writeFileAtomic } from "./files";
import { checkTarget, type Progress } from "./gcode";
import { type Project, ToolError } from "./projects";

/** Where the terrain is: a shape about a centre, or a ring of points. */
export type TerrainArea =
  | { centre: string; shape: "rectangle" | "ellipse"; widthKm: number; depthKm: number }
  | { ring: LonLat[] };

export type TerrainRequest = {
  area: TerrainArea;
  name?: string;
  longestSide?: number;
  exaggeration: number;
  base: number;
  /** An absolute path to also write the STL to (PRD-0014 T8). */
  stl?: string;
  overwrite?: boolean;
  /** The mesh's limits; the app's defaults unless a test needs a small mesh. */
  limits?: StlLimits;
};

/** The credit Mapterhorn's sources ask for (ADR-0076). */
export const ELEVATION_CREDIT =
  "Elevation data © Mapterhorn and its sources, https://mapterhorn.com/attribution";

/** Tiles are Web Mercator, which stops short of the poles (PRD-0014 non-goals). */
const MAX_LATITUDE = 85;
const EARTH_RADIUS = 6_371_008.8;
const DEGREE = Math.PI / 180;
/** Points of an ellipse's outline. */
const ELLIPSE_POINTS = 72;

/** The point `centre` gives, read without sending it anywhere (ADR-0082). */
function centreOf(centre: string): LonLat {
  const place = parsePlace(centre);
  if (place && typeof place === "object" && "center" in place) return place.center;
  if (place === "shortLink") {
    throw new ToolError(
      "A short Google Maps link holds no coordinates: ask the user to open it and give the full address the browser then shows.",
    );
  }
  throw new ToolError(
    `Can't read a place from ${JSON.stringify(centre)}: give its latitude and longitude (45.92, 9.39) or a full Google Maps or OpenStreetMap link. Place names aren't searched.`,
  );
}

/** A rectangle or ellipse `widthKm` × `depthKm` about `centre`, as longitude and latitude. */
export function shapeRing(
  [lon, lat]: LonLat,
  shape: "rectangle" | "ellipse",
  widthKm: number,
  depthKm: number,
): LonLat[] {
  const a = widthKm * 500;
  const b = depthKm * 500;
  const corners: [number, number][] =
    shape === "rectangle"
      ? [
          [-a, -b],
          [a, -b],
          [a, b],
          [-a, b],
        ]
      : Array.from({ length: ELLIPSE_POINTS }, (_, i) => {
          const angle = (2 * Math.PI * i) / ELLIPSE_POINTS;
          return [a * Math.cos(angle), b * Math.sin(angle)];
        });
  const kx = EARTH_RADIUS * DEGREE * Math.cos(lat * DEGREE);
  const ky = EARTH_RADIUS * DEGREE;
  return corners.map(([x, y]): LonLat => [lon + x / kx, lat + y / ky]);
}

function ringOf(area: TerrainArea): LonLat[] {
  const ring =
    "ring" in area
      ? area.ring
      : shapeRing(centreOf(area.centre), area.shape, area.widthKm, area.depthKm);
  // The mesh takes the ring without its first point repeated.
  const [first, last] = [ring[0], ring.at(-1)];
  const open = ring.length > 1 && first?.[0] === last?.[0] && first?.[1] === last?.[1];
  const points = open ? ring.slice(0, -1) : ring;
  if (points.some(([lon, lat]) => !(Math.abs(lat) <= MAX_LATITUDE && Math.abs(lon) <= 180))) {
    throw new ToolError(
      `The area must lie within ${MAX_LATITUDE}° of the equator and between longitudes -180° and 180°.`,
    );
  }
  return points;
}

/** The decoder's WebAssembly, read from the package (kept out of the bundle), compiled once. */
let decoder: Promise<(webp: ArrayBuffer) => Promise<ArrayLike<number>>> | undefined;
function webpDecoder() {
  decoder ??= (async () => {
    const { default: decode, init } = await import("@jsquash/webp/decode.js");
    const require = createRequire(import.meta.url);
    const wasm = await readFile(require.resolve("@jsquash/webp/codec/dec/webp_dec.wasm"));
    await init(await WebAssembly.compile(wasm));
    return async (webp: ArrayBuffer) => (await decode(webp)).data;
  })();
  return decoder;
}

/** `run`'s result; throws a `ToolError` with the app's message if the terrain can't be made. */
async function making<T>(run: () => T | Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof MessageError) throw new ToolError(text(error.detail));
    throw error;
  }
}

/**
 * Makes the terrain of `request.area` and adds it to `project` as its model,
 * at the chosen size and centred on the stock, as the app's *Terrain from a
 * map* does (PRD-0014 T11, ADR-0082). Fetches the area's elevation tiles from
 * Mapterhorn, and nothing else. Returns the model's id, size and detail.
 */
export async function importTerrain(
  project: Project,
  request: TerrainRequest,
  progress?: Progress,
  signal?: AbortSignal,
) {
  const { document } = project.store.getState();
  if (!canImportModel(document)) throw new ToolError(text(ONE_MODEL));
  if (request.stl !== undefined) {
    if (!isAbsolute(request.stl)) {
      throw new ToolError(`Give an absolute path, not ${JSON.stringify(request.stl)}.`);
    }
    await checkTarget(request.stl, request.overwrite ?? false);
  }
  const ring = ringOf(request.area);
  const plan = await making(() =>
    planTerrain(ring, request.limits ?? DEFAULT_STL_LIMITS, MAX_ELEVATION_ZOOM),
  );
  // Placed at this size, so no larger than the stock less its border, as in the app.
  const fitting = fittingSide(document.stock, plan.span);
  const longestSide = request.longestSide ?? fitting;
  if (longestSide > fitting + 1e-9) {
    throw new ToolError(
      `The longest side can be at most ${Math.floor(fitting * 10) / 10} mm, to fit inside the stock less the model border: make the stock larger first, or leave longestSide out.`,
    );
  }
  const settings: TerrainSettings = {
    longestSide,
    exaggeration: request.exaggeration,
    base: request.base,
  };
  const decode = await webpDecoder();
  const tiles = await making(() =>
    loadTerrainTiles(
      plan.tiles,
      (key) => fetchElevationTile(key, decode, signal),
      // No operation name: the client is told only how many tiles are done.
      (done, total) => void progress?.(done, total, ""),
    ),
  );
  signal?.throwIfAborted();
  const terrain = await making(() => terrainMesh(ring, plan, settings, tiles));
  const name = fileNameFor(request.name ?? "") || "Terrain";

  // Written before the model is added, so a file that can't be written changes nothing.
  if (request.stl !== undefined) {
    try {
      await writeFileAtomic(request.stl, terrain.stl, request.overwrite ?? false);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new ToolError(`${request.stl} already exists: pass overwrite to replace it.`);
      }
      throw new ToolError(`Can't write ${request.stl}: ${(error as Error).message}`);
    }
  }
  const bounds = { min: [0, 0, 0], max: terrain.size } satisfies Box3;
  const id = await addMesh(
    project,
    { triangles: terrain.triangles, bounds, fileName: `${name}.stl` },
    terrain.stl,
    { fit: false },
  );
  const tenths = (value: number) => Math.round(value * 10) / 10;
  return {
    id,
    size: terrain.size.map(tenths),
    heights: terrain.heights.map(Math.round),
    detail: {
      groundMetres: tenths(terrain.cellMetres),
      mmPerCell:
        Math.round((terrain.cellMetres * longestSide * 100) / Math.max(...plan.span)) / 100,
    },
    triangles: terrain.triangles,
    ...(request.stl !== undefined && { stl: request.stl }),
    credit: ELEVATION_CREDIT,
  };
}
