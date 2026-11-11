import type { TileKey } from "@furrow/cam-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchElevationTile, loadTerrainTiles } from "./terrain-tiles";

const heights = new Float32Array(4);

describe("loadTerrainTiles", () => {
  it("replaces a missing tile by its parent, fetched once for siblings", async () => {
    // z14 exists only at x = 10; the parent of x = 12 and 13 is z13 x = 6.
    const fetchTile = vi.fn(async ({ z, x }: TileKey) => (z === 13 || x === 10 ? heights : null));
    const progress = vi.fn();
    const tiles = await loadTerrainTiles(
      [
        { z: 14, x: 10, y: 4 },
        { z: 14, x: 12, y: 4 },
        { z: 14, x: 13, y: 4 },
      ],
      fetchTile,
      progress,
    );
    expect(tiles.map(({ z, x, y }) => `${z}/${x}/${y}`)).toEqual(["14/10/4", "13/6/2"]);
    expect(fetchTile).toHaveBeenCalledTimes(4);
    expect(progress).toHaveBeenLastCalledWith(4, 4);
  });

  it("reports done only at the end, even when the last tile falls back to its parent", async () => {
    const progress = vi.fn();
    await loadTerrainTiles(
      [
        { z: 14, x: 10, y: 4 },
        { z: 14, x: 12, y: 4 },
      ],
      async ({ z, x }) => (z === 13 || x === 10 ? heights : null),
      progress,
    );
    expect(progress.mock.calls).toEqual([
      [1, 2],
      [2, 3],
      [3, 3],
    ]);
  });

  it("gives up past zoom 0 and passes a failed request on", async () => {
    await expect(loadTerrainTiles([{ z: 1, x: 1, y: 1 }], async () => null)).resolves.toEqual([]);
    const offline = new Error("offline");
    await expect(
      loadTerrainTiles([{ z: 1, x: 0, y: 0 }], () => Promise.reject(offline)),
    ).rejects.toBe(offline);
  });
});

describe("fetchElevationTile", () => {
  const key = { z: 14, x: 8, y: 5 };
  // One pixel at 0 m: R 128, G 0, B 0.
  const decode = vi.fn(async () => [128, 0, 0, 255]);
  afterEach(() => vi.unstubAllGlobals());

  it("decodes the tile from Mapterhorn with the decoder it is given", async () => {
    const fetch = vi.fn(async () => new Response(new Uint8Array([1, 2])));
    vi.stubGlobal("fetch", fetch);
    expect(await fetchElevationTile(key, decode)).toEqual(new Float32Array([0]));
    expect(fetch).toHaveBeenCalledWith("https://tiles.mapterhorn.com/14/8/5.webp", {
      signal: undefined,
    });
  });

  it("gives null for a tile the service lacks, and refuses any other failure", async () => {
    vi.stubGlobal("fetch", async () => new Response(null, { status: 404 }));
    expect(await fetchElevationTile(key, decode)).toBeNull();
    vi.stubGlobal("fetch", async () => new Response(null, { status: 503 }));
    await expect(fetchElevationTile(key, decode)).rejects.toMatchObject({
      detail: { code: "workspace.terrainUnavailable" },
    });
    vi.stubGlobal("fetch", async () => new Response(new Uint8Array([1])));
    const broken = async () => Promise.reject(new Error("not a WebP"));
    await expect(fetchElevationTile(key, broken)).rejects.toMatchObject({
      detail: { code: "workspace.terrainUnavailable" },
    });
  });
});
