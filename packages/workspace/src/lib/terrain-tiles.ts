import { decodeTerrarium, type TerrainTile, type TileKey } from "@furrow/cam-core";
import { type Message, MessageError } from "@furrow/document";
import { elevationTileUrl } from "./terrain-services";

const TERRAIN_UNAVAILABLE: Message = { code: "workspace.terrainUnavailable" };

/**
 * Fetches the elevation tile `key` and gives its heights, or `null` where the
 * service has none at that zoom (a 404). `decode` turns the WebP into RGBA
 * pixels: the browser's own in the mesh worker, WebAssembly in the MCP server
 * (ADR-0082). Throws `workspace.terrainUnavailable` for any other failure.
 */
export async function fetchElevationTile(
  key: TileKey,
  decode: (webp: ArrayBuffer) => Promise<ArrayLike<number>>,
  signal?: AbortSignal,
): Promise<Float32Array | null> {
  const response = await fetch(elevationTileUrl(key), { signal }).catch((error: unknown) => {
    // Cancelled, not unavailable: the caller hears the abort itself.
    if (signal?.aborted) throw error;
    return null;
  });
  if (response?.status === 404) return null;
  if (!response?.ok) throw new MessageError(TERRAIN_UNAVAILABLE);
  const pixels = await response
    .arrayBuffer()
    .then(decode)
    .catch(() => {
      throw new MessageError(TERRAIN_UNAVAILABLE);
    });
  return decodeTerrarium(pixels);
}

const keyOf = ({ z, x, y }: TileKey) => `${z}/${x}/${y}`;

/**
 * Fetches the elevation tiles `keys` with `fetchTile`, which gives a tile's
 * heights or `null` where the service has none at that zoom; a missing tile
 * is replaced by its parent, and so on up (ADR-0077). Siblings that share a
 * parent fetch it once. `onProgress` hears how many requests are done of
 * those known so far.
 */
export async function loadTerrainTiles(
  keys: readonly TileKey[],
  fetchTile: (key: TileKey) => Promise<Float32Array | null>,
  onProgress?: (done: number, total: number) => void,
): Promise<TerrainTile[]> {
  const requests = new Map<string, Promise<TerrainTile | null>>();
  let done = 0;
  function load(key: TileKey): Promise<TerrainTile | null> {
    const id = keyOf(key);
    let request = requests.get(id);
    if (!request) {
      request = fetchTile(key).then((heights) => {
        // The parent is queued before reporting, so `done` reaches `total` only at the end.
        const parent =
          heights || key.z === 0 ? null : load({ z: key.z - 1, x: key.x >> 1, y: key.y >> 1 });
        onProgress?.(++done, requests.size);
        return heights ? { ...key, heights } : parent;
      });
      requests.set(id, request);
    }
    return request;
  }
  const found = await Promise.all(keys.map(load));
  const unique = new Map<string, TerrainTile>();
  for (const tile of found) if (tile) unique.set(keyOf(tile), tile);
  return [...unique.values()];
}
