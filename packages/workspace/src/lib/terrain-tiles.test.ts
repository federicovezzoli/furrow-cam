import type { TileKey } from "@furrow/cam-core";
import { describe, expect, it, vi } from "vitest";
import { loadTerrainTiles } from "./terrain-tiles";

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

  it("gives up past zoom 0 and passes a failed request on", async () => {
    await expect(loadTerrainTiles([{ z: 1, x: 1, y: 1 }], async () => null)).resolves.toEqual([]);
    const offline = new Error("offline");
    await expect(
      loadTerrainTiles([{ z: 1, x: 0, y: 0 }], () => Promise.reject(offline)),
    ).rejects.toBe(offline);
  });
});
