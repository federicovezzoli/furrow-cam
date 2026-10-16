import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadMesh, readCachedMesh } from "./mesh-cache";
import { sha256Hex } from "./mesh-worker-protocol";

const PROJECT = "00000000-0000-4000-8000-000000000001";

const meshes = vi.hoisted(() => ({ downloadMesh: vi.fn() }));
vi.mock("@/features/assets/lib/meshes", () => meshes);

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

describe("loadMesh", () => {
  it("returns a cached copy that matches its hash without downloading", async () => {
    cacheCopy([1, 2, 3]);
    expect(new Uint8Array(await loadMesh(PROJECT, sha256))).toEqual(new Uint8Array([1, 2, 3]));
    expect(meshes.downloadMesh).not.toHaveBeenCalled();
  });

  it("downloads and caches a file that isn't cached", async () => {
    meshes.downloadMesh.mockResolvedValue(good);
    expect(await loadMesh(PROJECT, sha256)).toBe(good);
    expect(meshes.downloadMesh).toHaveBeenCalledWith(PROJECT, sha256);
    expect(new Uint8Array((await readCachedMesh(sha256)) ?? new ArrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3]),
    );
  });

  it("evicts a cached copy that doesn't match its hash and downloads the file again", async () => {
    cacheCopy([1, 2]);
    meshes.downloadMesh.mockResolvedValue(good);
    expect(await loadMesh(PROJECT, sha256)).toBe(good);
    expect(cache.delete).toHaveBeenCalledOnce();
    expect(meshes.downloadMesh).toHaveBeenCalledOnce();
    expect(new Uint8Array((await readCachedMesh(sha256)) ?? new ArrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3]),
    );
  });

  it("returns a download that doesn't match its hash for the reader to reject", async () => {
    cacheCopy([1, 2]);
    const bad = new Uint8Array([9]).buffer;
    meshes.downloadMesh.mockResolvedValue(bad);
    expect(await loadMesh(PROJECT, sha256)).toBe(bad);
    expect(meshes.downloadMesh).toHaveBeenCalledOnce();
  });
});
