import {
  type Box3,
  imageReliefMesh,
  modelHeightmap,
  parseStl,
  planTerrain,
  reliefPixels,
  type StlMesh,
  terrainMesh,
} from "@furrow/cam-core";
import { type Message, MessageError } from "@furrow/document";
import { type MeshRequest, type MeshResponse, sha256Hex } from "../lib/mesh-worker-protocol";
import { isStepFile, stepToStl } from "../lib/step";
import { MAX_ELEVATION_ZOOM } from "../lib/terrain-services";
import { fetchElevationTile, loadTerrainTiles } from "../lib/terrain-tiles";

/** The worker's global scope; the app's TypeScript lib describes a window instead. */
const scope = self as unknown as {
  onmessage: (event: MessageEvent<MeshRequest>) => void;
  postMessage: (response: MeshResponse, transfer?: Transferable[]) => void;
};

/**
 * Meshes read lately, by hash, least recently used first. A 2-million-triangle
 * mesh takes 72 MB, so only a few are kept; the rest are sent again.
 */
const meshes = new Map<string, StlMesh>();
const KEPT_MESHES = 4;

function keep(sha256: string, mesh: StlMesh) {
  meshes.delete(sha256);
  meshes.set(sha256, mesh);
  for (const oldest of meshes.keys()) {
    if (meshes.size <= KEPT_MESHES) break;
    meshes.delete(oldest);
  }
}

/** A stored mesh was checked when it was imported; limits lowered since don't refuse it. */
const NO_LIMITS = { maxBytes: Infinity, maxTriangles: Infinity };

/** OpenCascade's WebAssembly, bundled with the app and fetched only for a STEP file (ADR-0072). */
async function occtWasm() {
  const url = new URL("occt-import-js/dist/occt-import-js.wasm", import.meta.url);
  const response = await fetch(url).catch(() => null);
  if (!response?.ok) throw new MessageError({ code: "workspace.stepImportUnavailable" });
  return response.arrayBuffer();
}

/**
 * An image's RGBA pixels, decoded by the browser; with `fit`, shrunk first to
 * the size it gives for the image's own.
 */
async function decodePixels(
  image: Blob,
  options: ImageBitmapOptions,
  fit?: (width: number, height: number) => [number, number],
): Promise<ImageData> {
  let bitmap = await createImageBitmap(image, options);
  const [width, height] = fit?.(bitmap.width, bitmap.height) ?? [bitmap.width, bitmap.height];
  if (width < bitmap.width) {
    const full = bitmap;
    const resize = { resizeWidth: width, resizeHeight: height, resizeQuality: "high" } as const;
    bitmap = await createImageBitmap(full, { ...options, ...resize });
    full.close();
  }
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("No 2D context");
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  return context.getImageData(0, 0, canvas.width, canvas.height);
}

/** A WebP tile's RGBA pixels. */
async function decodeWebp(webp: ArrayBuffer): Promise<Uint8ClampedArray> {
  // The pixels are data, not colours: no colour management or premultiplied alpha.
  const options = { colorSpaceConversion: "none", premultiplyAlpha: "none" } as const;
  return (await decodePixels(new Blob([webp], { type: "image/webp" }), options)).data;
}

async function handle(request: MeshRequest): Promise<MeshResponse> {
  const { id } = request;
  if (request.kind === "image") {
    // Colours turned into sRGB, as the image is seen; transparency stays apart from them.
    // Shrunk to what the grid can use, so a large photo's pixels aren't all read.
    let original = 0;
    const pixels = await decodePixels(
      new Blob([request.image]),
      { premultiplyAlpha: "none" },
      (width, height) => {
        original = width;
        return reliefPixels(width, height, request.limits);
      },
    );
    // The smoothing is in the picked image's pixels, not the shrunk ones.
    const blur = (request.settings.blur * pixels.width) / original;
    const { stl, triangles, size, cells } = imageReliefMesh(
      pixels,
      { ...request.settings, blur },
      request.limits,
    );
    const sha256 = await sha256Hex(stl.buffer);
    const bounds = { min: [0, 0, 0], max: size } satisfies Box3;
    return { kind: "image", id, sha256, triangles, bounds, size, cells, stl: stl.buffer };
  }
  if (request.kind === "terrain") {
    const { ring, settings, limits } = request;
    const plan = planTerrain(ring, limits, MAX_ELEVATION_ZOOM);
    const tiles = await loadTerrainTiles(
      plan.tiles,
      (key) => fetchElevationTile(key, decodeWebp),
      (done, total) => scope.postMessage({ kind: "terrainProgress", id, done, total }),
    );
    const { stl, triangles, size, ...terrain } = terrainMesh(ring, plan, settings, tiles);
    const sha256 = await sha256Hex(stl.buffer);
    const bounds = { min: [0, 0, 0], max: size } satisfies Box3;
    return { kind: "terrain", id, sha256, triangles, bounds, size, stl: stl.buffer, ...terrain };
  }
  if (request.kind === "parse") {
    const step = isStepFile(new Uint8Array(request.bytes));
    const bytes = step
      ? (await stepToStl(new Uint8Array(request.bytes), request.limits, occtWasm)).buffer
      : request.bytes;
    const mesh = parseStl(new Uint8Array(bytes), request.limits);
    const sha256 = await sha256Hex(bytes);
    keep(sha256, mesh);
    const { triangles, bounds } = mesh;
    return { kind: "parsed", id, sha256, triangles, bounds, ...(step && { stl: bytes }) };
  }

  let mesh = meshes.get(request.sha256);
  if (!mesh) {
    if (!request.bytes) return { kind: "missing", id };
    if ((await sha256Hex(request.bytes)) !== request.sha256) {
      return { kind: "failed", id, error: { code: "workspace.storedModelMismatch" } };
    }
    mesh = parseStl(new Uint8Array(request.bytes), NO_LIMITS);
  }
  keep(request.sha256, mesh);
  const heightmap = modelHeightmap(mesh.positions, request.bounds, request.rotation);
  return { kind: "preview", id, heightmap };
}

// Requests are answered in the order they arrive, one at a time.
let queue = Promise.resolve();

scope.onmessage = ({ data }) => {
  queue = queue.then(async () => {
    try {
      const response = await handle(data);
      const transfer =
        response.kind === "preview" && response.heightmap
          ? [response.heightmap.heights.buffer]
          : (response.kind === "parsed" ||
                response.kind === "terrain" ||
                response.kind === "image") &&
              response.stl
            ? [response.stl]
            : [];
      scope.postMessage(response, transfer);
    } catch (error) {
      if (!(error instanceof MessageError)) console.error(error);
      const message: Message =
        error instanceof MessageError ? error.detail : { code: "workspace.unreadableFile" };
      scope.postMessage({ kind: "failed", id: data.id, error: message });
    }
  });
};
