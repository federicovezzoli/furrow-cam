import { sha256Hex } from "@furrow/workspace/lib/mesh-worker-protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadAsset, readCachedAsset } from "./asset-cache";

const PROJECT = "00000000-0000-4000-8000-000000000001";

const meshes = vi.hoisted(() => ({ downloadAsset: vi.fn() }));
vi.mock("@/features/assets/lib/assets", () => meshes);

/** Cache Storage with one cache, keyed by URL. */
const stored = new Map<string, Blob>();
const cache = {
  match: async (key: string) => {
    const blob = stored.get(key);
    return blob ? new Response(blob) : undefined;
  },
  put: async (key: string, response: Response) => {
    stored.set(key, await response.blob());
  },
  delete: vi.fn(async (key: string) => stored.delete(key)),
};

const good = new Uint8Array([1, 2, 3]).buffer;
let sha256: string;

beforeEach(async () => {
  vi.stubGlobal("caches", { open: async () => cache });
  vi.stubGlobal("location", { origin: "http://localhost:3000" });
  sha256 = await sha256Hex(good);
});

afterEach(() => {
  stored.clear();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function cacheCopy(bytes: number[]) {
  stored.set(`http://localhost:3000/__meshes/${sha256}`, new Blob([new Uint8Array(bytes)]));
}

describe("loadAsset", () => {
  it("returns a cached copy that matches its hash without downloading", async () => {
    cacheCopy([1, 2, 3]);
    expect(new Uint8Array(await loadAsset(PROJECT, sha256))).toEqual(new Uint8Array([1, 2, 3]));
    expect(meshes.downloadAsset).not.toHaveBeenCalled();
  });

  it("downloads and caches a file that isn't cached", async () => {
    meshes.downloadAsset.mockResolvedValue(good);
    expect(await loadAsset(PROJECT, sha256)).toBe(good);
    expect(meshes.downloadAsset).toHaveBeenCalledWith(PROJECT, sha256);
    expect(new Uint8Array((await readCachedAsset(sha256)) ?? new ArrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3]),
    );
  });

  it("evicts a cached copy that doesn't match its hash and downloads the file again", async () => {
    cacheCopy([1, 2]);
    meshes.downloadAsset.mockResolvedValue(good);
    expect(await loadAsset(PROJECT, sha256)).toBe(good);
    expect(cache.delete).toHaveBeenCalledOnce();
    expect(meshes.downloadAsset).toHaveBeenCalledOnce();
    expect(new Uint8Array((await readCachedAsset(sha256)) ?? new ArrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3]),
    );
  });

  it("returns a download that doesn't match its hash for the reader to reject", async () => {
    cacheCopy([1, 2]);
    const bad = new Uint8Array([9]).buffer;
    meshes.downloadAsset.mockResolvedValue(bad);
    expect(await loadAsset(PROJECT, sha256)).toBe(bad);
    expect(meshes.downloadAsset).toHaveBeenCalledOnce();
  });
});
