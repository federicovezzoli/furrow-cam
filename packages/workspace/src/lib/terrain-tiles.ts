import type { TerrainTile, TileKey } from "@furrow/cam-core";

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
