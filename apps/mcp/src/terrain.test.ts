import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodeTerrarium, planTerrain, TERRAIN_TILE_SIZE, terrainMesh } from "@furrow/cam-core";
import { MAX_ELEVATION_ZOOM } from "@furrow/workspace/lib/terrain-services";
import { shapeRing } from "@furrow/workspace/lib/terrain-square";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createProjects, type Project, ToolError } from "./projects";
import { importTerrain, type TerrainRequest } from "./terrain";

/** A Terrarium tile whose heights rise from 1000 m on its west edge by 0.1 m a pixel. */
const SIZE = TERRAIN_TILE_SIZE;
const pixels = new Uint8ClampedArray(SIZE * SIZE * 4);
for (let i = 0; i < SIZE * SIZE; i++) {
  const value = 1000 + (i % SIZE) / 10 + 32768;
  pixels.set([Math.floor(value / 256), Math.floor(value) % 256, (value % 1) * 256, 255], i * 4);
}
let webp: ArrayBuffer;

beforeAll(async () => {
  // The encoder's module itself: `encode.js` detects SIMD with syntax Vitest can't load.
  const { default: factory } = await import("@jsquash/webp/codec/enc/webp_enc.js");
  const { defaultOptions } = await import("@jsquash/webp/meta.js");
  const { initEmscriptenModule } = await import("@jsquash/webp/utils.js");
  const require = createRequire(import.meta.url);
  const wasm = await readFile(require.resolve("@jsquash/webp/codec/enc/webp_enc.wasm"));
  const encoder = await initEmscriptenModule(factory, await WebAssembly.compile(wasm));
  const options = { ...defaultOptions, lossless: 1, exact: 1 };
  webp = encoder.encode(pixels, SIZE, SIZE, options)?.buffer as ArrayBuffer;
});

let dir: string;
let project: Project;
const fetchTile = vi.fn(async (_url: string) => new Response(webp.slice(0)));

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "furrow-mcp-"));
  project = await createProjects().create(join(dir, "Peak.furrow"));
  fetchTile.mockClear();
  vi.stubGlobal("fetch", fetchTile);
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await rm(dir, { recursive: true, force: true });
});

const area = { centre: "45.92, 9.39", shape: "rectangle", widthKm: 2, depthKm: 1 } as const;
/** A small mesh, so each test makes it quickly. */
const limits = { maxBytes: Number.POSITIVE_INFINITY, maxTriangles: 5_000 };
const request: TerrainRequest = { area, name: "Pizzo", exaggeration: 1.5, base: 3, limits };

/** The message of the `ToolError` `run` throws. */
async function refusal(run: Promise<unknown>) {
  const error = await run.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(ToolError);
  return (error as ToolError).message;
}

// Each test decodes and meshes tiles: slower than most when every package runs at once.
describe("importTerrain", { timeout: 30_000 }, () => {
  it("adds the app's mesh as the model, at its size and centred on the stock, from Mapterhorn only", async () => {
    const result = await importTerrain(async () => project, { ...request, longestSide: 100 });
    const [model] = project.store.getState().document.models;
    expect(model).toMatchObject({ id: result.id, fileName: "Pizzo.stl" });
    expect(model?.placement).toMatchObject({ scale: 1, rotation: [0, 0, 0], top: 0 });
    expect(result.size[0]).toBeCloseTo(100, 0);
    expect(result.credit).toMatch(/Mapterhorn/);
    expect(fetchTile).toHaveBeenCalled();
    for (const [url] of fetchTile.mock.calls) {
      expect(url).toMatch(/^https:\/\/tiles\.mapterhorn\.com\/\d+\/\d+\/\d+\.webp$/);
    }

    // The worker's mesh from the same pixels: the same bytes.
    const ring = shapeRing([9.39, 45.92], "rectangle", 2, 1);
    const plan = planTerrain(ring, limits, MAX_ELEVATION_ZOOM);
    const heights = decodeTerrarium(pixels);
    const tiles = plan.tiles.map((key) => ({ ...key, heights }));
    const settings = { longestSide: 100, exaggeration: 1.5, base: 3 };
    const { stl } = terrainMesh(ring, plan, settings, tiles);
    expect(project.meshes.get(model?.sha256 ?? "")).toEqual(stl);
  });

  it("fits the stock less its border by default, and refuses a larger side", async () => {
    const message = await refusal(
      importTerrain(async () => project, { ...request, longestSide: 10_000 }),
    );
    expect(message).toMatch(/at most [\d.]+ mm/);
    expect(fetchTile).not.toHaveBeenCalled();
    const { size } = await importTerrain(async () => project, request);
    const { stock } = project.store.getState().document;
    expect(Math.max(...size.slice(0, 2))).toBeLessThan(Math.max(stock.width, stock.height));
  });

  it("refuses a project that has a model, before fetching anything", async () => {
    await importTerrain(async () => project, request);
    fetchTile.mockClear();
    expect(await refusal(importTerrain(async () => project, request))).toMatch(/model/i);
    expect(fetchTile).not.toHaveBeenCalled();
  });

  it("never searches a name, and refuses a short link", async () => {
    const name = { ...request, area: { ...area, centre: "Pizzo Arera" } };
    expect(await refusal(importTerrain(async () => project, name))).toMatch(/aren't searched/);
    const short = { ...request, area: { ...area, centre: "https://maps.app.goo.gl/abc" } };
    expect(await refusal(importTerrain(async () => project, short))).toMatch(
      /short Google Maps link/,
    );
    expect(fetchTile).not.toHaveBeenCalled();
  });

  it("reads a full map link, and a ring with its first point repeated", async () => {
    const link = "https://www.openstreetmap.org/#map=14/45.92/9.39";
    await importTerrain(async () => project, { ...request, area: { ...area, centre: link } });
    const ring = shapeRing([9.39, 45.92], "ellipse", 1, 1);
    const other = await createProjects().create(join(dir, "Other.furrow"));
    await importTerrain(async () => other, {
      ...request,
      area: { ring: [...ring, ring[0] as never] },
    });
    expect(other.store.getState().document.models).toHaveLength(1);
  });

  it("says the elevation couldn't be loaded when offline, changing nothing", async () => {
    fetchTile.mockRejectedValue(new TypeError("fetch failed"));
    expect(await refusal(importTerrain(async () => project, request))).toMatch(
      /elevation data couldn't/,
    );
    expect(project.store.getState().document.models).toHaveLength(0);
    fetchTile.mockImplementation(async () => new Response(webp.slice(0)));
  });

  it("refuses an area too wide, with the app's message", async () => {
    const wide = { ...request, area: { ...area, widthKm: 250 } };
    expect(await refusal(importTerrain(async () => project, wide))).toMatch(/200 km/);
  });

  it("adds the model to the project as it is once the terrain is made", async () => {
    // The user saved in the app meanwhile, so the server read the project again.
    const reread = await createProjects().create(join(dir, "Reread.furrow"));
    const open = vi.fn().mockResolvedValueOnce(project).mockResolvedValue(reread);
    await importTerrain(open, request);
    expect(project.store.getState().document.models).toHaveLength(0);
    expect(reread.store.getState().document.models).toHaveLength(1);
  });

  it("refuses an STL path that isn't one, such as the project's own file", async () => {
    const stl = join(dir, "Peak.furrow");
    const message = await refusal(
      importTerrain(async () => project, { ...request, stl, overwrite: true }),
    );
    expect(message).toMatch(/ending in \.stl/);
    expect(fetchTile).not.toHaveBeenCalled();
  });

  it("writes the STL too, never over a file unless asked", async () => {
    const stl = join(dir, "Pizzo.stl");
    await writeFile(stl, "mine");
    expect(await refusal(importTerrain(async () => project, { ...request, stl }))).toMatch(
      /already exists/,
    );
    expect(fetchTile).not.toHaveBeenCalled();
    await importTerrain(async () => project, { ...request, stl, overwrite: true });
    const [model] = project.store.getState().document.models;
    expect(new Uint8Array(await readFile(stl))).toEqual(project.meshes.get(model?.sha256 ?? ""));
  });
});
