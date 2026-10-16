import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StoredObject } from "./server";

const NOW = new Date("2026-10-16T03:00:00Z");
const HOUR = 60 * 60 * 1000;
const LONG_AGO = new Date(NOW.getTime() - 48 * HOUR);
const JUST_NOW = new Date(NOW.getTime() - 5 * 60 * 1000);

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);

type Asset = {
  id: string;
  projectId: string;
  sha256: string;
  verifiedAt: Date | null;
  createdAt: Date;
};

const mocks = vi.hoisted(() => ({
  storage: true,
  secret: "cron-secret-of-sixteen" as string | undefined,
  projects: [] as { id: string; userId: string }[],
  assets: [] as Asset[],
}));

vi.mock("@/env", () => ({
  env: {
    get CRON_SECRET() {
      return mocks.secret;
    },
  },
}));
vi.mock("./server", () => ({
  URL_LIFETIME: 15 * 60,
  isStorageConfigured: () => mocks.storage,
  assetKey: (userId: string, projectId: string, sha256: string) =>
    `${userId}/${projectId}/${sha256}`,
  // The bucket behind the route's own sweep: empty.
  listObjects: async function* () {},
  deleteObjects: async () => {},
}));
vi.mock("@/lib/db", () => ({
  db: {
    projectAsset: {
      deleteMany: async ({ where }: { where: { verifiedAt: null; createdAt: { lt: Date } } }) => {
        const before = mocks.assets.length;
        mocks.assets = mocks.assets.filter(
          (a) => a.verifiedAt !== null || a.createdAt >= where.createdAt.lt,
        );
        return { count: before - mocks.assets.length };
      },
      findMany: async ({ where }: { where: { projectId: { in: string[] } } }) =>
        mocks.assets.flatMap((a) => {
          const project = mocks.projects.find((p) => p.id === a.projectId);
          return project && where.projectId.in.includes(a.projectId)
            ? [
                {
                  id: a.id,
                  projectId: a.projectId,
                  sha256: a.sha256,
                  project: { userId: project.userId },
                },
              ]
            : [];
        }),
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: { in: string[] }; verifiedAt: { lte: Date } };
        data: Partial<Asset>;
      }) => {
        const matched = mocks.assets.filter(
          (a) => where.id.in.includes(a.id) && a.verifiedAt && a.verifiedAt <= where.verifiedAt.lte,
        );
        for (const a of matched) Object.assign(a, data);
        return { count: matched.length };
      },
    },
  },
}));

const { handleSweepRequest, sweepAssets } = await import("./sweep");

/** An in-memory bucket, listed in pages of `pageSize`. */
function fakeStorage(objects: StoredObject[], pageSize = 2, onDelete = () => {}) {
  const stored = new Map(objects.map((object) => [object.key, object]));
  return {
    keys: () => [...stored.keys()].sort(),
    async *listObjects() {
      const all = [...stored.values()];
      for (let i = 0; i < all.length; i += pageSize) yield all.slice(i, i + pageSize);
    },
    async deleteObjects(keys: readonly string[]) {
      onDelete();
      for (const key of keys) stored.delete(key);
    },
  };
}

function asset(projectId: string, sha256: string, verified: boolean, createdAt = LONG_AGO) {
  return {
    id: `${projectId}-${sha256}`,
    projectId,
    sha256,
    verifiedAt: verified ? createdAt : null,
    createdAt,
  };
}

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  mocks.storage = true;
  mocks.secret = "cron-secret-of-sixteen";
  mocks.projects = [
    { id: "live", userId: "u1" },
    { id: "other", userId: "u2" },
  ];
  mocks.assets = [];
});

describe("sweepAssets", () => {
  it("deletes the objects of deleted projects and keeps live projects' objects", async () => {
    mocks.assets = [asset("live", SHA_A, true), asset("other", SHA_A, true)];
    const storage = fakeStorage([
      { key: `u1/live/${SHA_A}`, lastModified: LONG_AGO },
      { key: `u2/other/${SHA_A}`, lastModified: LONG_AGO },
      { key: `u1/deleted/${SHA_A}`, lastModified: LONG_AGO },
      { key: `u1/deleted/${SHA_B}`, lastModified: LONG_AGO },
      { key: `u3/gone/${SHA_A}`, lastModified: LONG_AGO },
    ]);
    expect(await sweepAssets(storage, NOW)).toEqual({ assets: 0, objects: 3, unverified: 0 });
    expect(storage.keys()).toEqual([`u1/live/${SHA_A}`, `u2/other/${SHA_A}`]);
  });

  it("deletes unverified assets older than a day, with their objects", async () => {
    mocks.assets = [
      asset("live", SHA_A, false),
      asset("live", SHA_B, false, new Date(NOW.getTime() - HOUR)),
    ];
    const storage = fakeStorage([
      { key: `u1/live/${SHA_A}`, lastModified: LONG_AGO },
      { key: `u1/live/${SHA_B}`, lastModified: LONG_AGO },
    ]);
    expect(await sweepAssets(storage, NOW)).toEqual({ assets: 1, objects: 1, unverified: 0 });
    expect(mocks.assets.map(({ sha256 }) => sha256)).toEqual([SHA_B]);
    expect(storage.keys()).toEqual([`u1/live/${SHA_B}`]);
  });

  it("unverifies an asset verified against an object while the sweep deleted it", async () => {
    // Phase 1 deletes the stale row; then the user imports the same file again, and the
    // upload request finds the old object and verifies a new row before it's deleted.
    mocks.assets = [asset("live", SHA_A, false)];
    const storage = fakeStorage([{ key: `u1/live/${SHA_A}`, lastModified: LONG_AGO }], 2, () => {
      mocks.assets.push({ ...asset("live", SHA_A, true, new Date()), id: "retried" });
    });
    expect(await sweepAssets(storage, NOW)).toEqual({ assets: 1, objects: 1, unverified: 1 });
    expect(storage.keys()).toEqual([]);
    expect(mocks.assets).toMatchObject([{ id: "retried", verifiedAt: null }]);
  });

  it("never touches recent objects, so uploads in flight finish", async () => {
    const storage = fakeStorage([
      { key: `u1/deleted/${SHA_A}`, lastModified: JUST_NOW },
      { key: `u1/live/${SHA_B}`, lastModified: JUST_NOW },
    ]);
    expect(await sweepAssets(storage, NOW)).toEqual({ assets: 0, objects: 0, unverified: 0 });
    expect(storage.keys()).toHaveLength(2);
  });

  it("keeps objects under the right project but the wrong user", async () => {
    mocks.assets = [asset("live", SHA_A, true)];
    const storage = fakeStorage([{ key: `u2/live/${SHA_A}`, lastModified: LONG_AGO }]);
    expect(await sweepAssets(storage, NOW)).toEqual({ assets: 0, objects: 1, unverified: 0 });
  });

  it("leaves keys that aren't asset keys alone", async () => {
    const storage = fakeStorage([
      { key: "readme.txt", lastModified: LONG_AGO },
      { key: "a/b/c/d", lastModified: LONG_AGO },
      { key: "u1//x", lastModified: LONG_AGO },
    ]);
    expect(await sweepAssets(storage, NOW)).toEqual({ assets: 0, objects: 0, unverified: 0 });
    expect(storage.keys()).toHaveLength(3);
  });

  it("logs counts, not keys", async () => {
    const storage = fakeStorage([{ key: `u1/deleted/${SHA_A}`, lastModified: LONG_AGO }]);
    await sweepAssets(storage, NOW);
    expect(console.info).toHaveBeenCalledWith(
      "Asset sweep: deleted 0 unverified assets and 1 objects, unverified 0 assets",
    );
  });
});

describe("handleSweepRequest", () => {
  const request = (authorization?: string) =>
    new Request("http://localhost/api/cron/sweep-assets", {
      headers: authorization ? { authorization } : {},
    });

  it("refuses requests without the secret", async () => {
    expect((await handleSweepRequest(request())).status).toBe(401);
    expect((await handleSweepRequest(request("Bearer wrong"))).status).toBe(401);
    mocks.secret = undefined;
    expect((await handleSweepRequest(request("Bearer "))).status).toBe(401);
    expect((await handleSweepRequest(request("Bearer undefined"))).status).toBe(401);
  });

  it("sweeps for callers with the secret", async () => {
    const response = await handleSweepRequest(request("Bearer cron-secret-of-sixteen"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ assets: 0, objects: 0, unverified: 0 });
  });

  it("is off without storage", async () => {
    mocks.storage = false;
    expect((await handleSweepRequest(request("Bearer cron-secret-of-sixteen"))).status).toBe(404);
  });
});
