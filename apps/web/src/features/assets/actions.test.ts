import { model } from "@furrow/document/fixtures";
import { beforeEach, describe, expect, it, vi } from "vitest";

const USER = "user-1";
const PROJECT = "00000000-0000-4000-8000-000000000001";
const SHA = model.sha256;
const KEY = `${USER}/${PROJECT}/${SHA}`;

/** A filter `discardAsset` asks whether the document, or a version, lists a file with. */
type ListFilter = { path: string[]; array_contains: { sha256: string }[] };
type Filter = { document: ListFilter } | { versions: { some: { document: ListFilter } } };

type Asset = {
  projectId: string;
  sha256: string;
  size: number;
  verifiedAt: Date | null;
  createdAt?: Date;
};

const mocks = vi.hoisted(() => ({
  userId: "user-1" as string | null,
  storage: true,
  projects: [] as { id: string; userId: string }[],
  /** Hashes of the meshes that each project's saved document or versions refer to. */
  referenced: new Map<string, Set<string>>(),
  /** Projects whose row a transaction locked. */
  locked: [] as string[],
  assets: [] as Asset[],
  /** Stored objects by key: their size and hash. */
  objects: new Map<string, { size: number; sha256: string }>(),
}));

vi.mock("@/features/auth/server", () => ({ getUserId: async () => mocks.userId }));
vi.mock("./server", () => ({
  MAX_MESH_BYTES: 50_000_000,
  isStorageConfigured: () => mocks.storage,
  assetKey: (userId: string, projectId: string, sha256: string) =>
    `${userId}/${projectId}/${sha256}`,
  checkObject: async (key: string, size: number, sha256: string) => {
    const object = mocks.objects.get(key);
    if (!object) return "missing";
    return object.size === size && object.sha256 === sha256 ? "ok" : "mismatch";
  },
  deleteObject: async (key: string) => {
    mocks.objects.delete(key);
  },
  presignUpload: async (key: string) => ({ url: `https://storage/${key}?put`, headers: {} }),
  presignDownload: async (key: string) => `https://storage/${key}?get`,
}));
vi.mock("@/lib/db", () => {
  type Unique = { projectId_sha256: { projectId: string; sha256: string } };
  const find = ({ projectId_sha256: { projectId, sha256 } }: Unique) =>
    mocks.assets.find((a) => a.projectId === projectId && a.sha256 === sha256);
  const models = {
    /** Only `lockProject`'s `SELECT … FOR UPDATE` is expected. */
    $executeRaw: async (_sql: TemplateStringsArray, projectId: string) => {
      mocks.locked.push(projectId);
      return 1;
    },
    project: {
      findFirst: async ({ where }: { where: { id: string; userId: string } }) =>
        mocks.projects.find((p) => p.id === where.id && p.userId === where.userId) ?? null,
      // Only the query `discardAsset` makes: does the project's document or a version list the file?
      count: async ({ where }: { where: { id: string; OR: Filter[] } }) => {
        const asked = where.OR.map((filter) => {
          const document = "document" in filter ? filter.document : filter.versions.some.document;
          return `${document.path[0]}:${document.array_contains[0]?.sha256}`;
        });
        return asked.some((use) => mocks.referenced.get(where.id)?.has(use)) ? 1 : 0;
      },
    },
    projectAsset: {
      upsert: async ({ where, create }: { where: Unique; create: Omit<Asset, "verifiedAt"> }) => {
        const existing = find(where);
        if (existing) return existing;
        const asset = { ...create, verifiedAt: null };
        mocks.assets.push(asset);
        return asset;
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { projectId: string; sha256: string; verifiedAt: null };
        data: Partial<Asset>;
      }) => {
        const asset = find({ projectId_sha256: where });
        if (asset && asset.verifiedAt === null) Object.assign(asset, data);
        return { count: asset && asset.verifiedAt === null ? 1 : 0 };
      },
      update: async ({ where, data }: { where: Unique; data: Partial<Asset> }) =>
        Object.assign(find(where) ?? {}, data),
      findUnique: async ({ where }: { where: Unique }) => find(where) ?? null,
      deleteMany: async ({ where }: { where: { projectId: string; sha256: string } }) => {
        const before = mocks.assets.length;
        mocks.assets = mocks.assets.filter(
          (a) => a.projectId !== where.projectId || a.sha256 !== where.sha256,
        );
        return { count: before - mocks.assets.length };
      },
      findFirst: async ({ where }: { where: { projectId: string; sha256: string } }) =>
        mocks.assets.find(
          (a) => a.projectId === where.projectId && a.sha256 === where.sha256 && a.verifiedAt,
        ) ?? null,
    },
  };
  return {
    db: { ...models, $transaction: <T>(fn: (tx: typeof models) => Promise<T>) => fn(models) },
  };
});

const { discardAsset, getAssetUrl, requestAssetUpload, verifyAssetUpload } = await import(
  "./actions"
);

/** What the browser does with a presigned URL: stores the bytes it has. */
function upload(size = model.size, sha256 = SHA) {
  mocks.objects.set(KEY, { size, sha256 });
}

beforeEach(() => {
  mocks.userId = USER;
  mocks.storage = true;
  mocks.projects = [{ id: PROJECT, userId: USER }];
  mocks.assets = [];
  mocks.referenced.clear();
  mocks.locked = [];
  mocks.objects.clear();
});

describe("requestAssetUpload", () => {
  it("records an unverified asset and returns an upload URL for its key", async () => {
    expect(await requestAssetUpload(PROJECT, SHA, model.size, "mesh")).toEqual({
      upload: { url: `https://storage/${KEY}?put`, headers: {} },
    });
    expect(mocks.assets).toEqual([
      { projectId: PROJECT, sha256: SHA, size: model.size, verifiedAt: null },
    ]);
  });

  it("needs no upload when the project already has the mesh", async () => {
    mocks.assets.push({
      projectId: PROJECT,
      sha256: SHA,
      size: model.size,
      verifiedAt: new Date(),
    });
    expect(await requestAssetUpload(PROJECT, SHA, model.size, "mesh")).toEqual({ uploaded: true });
  });

  it("verifies an earlier upload that was never verified", async () => {
    await requestAssetUpload(PROJECT, SHA, model.size, "mesh");
    upload();
    expect(await requestAssetUpload(PROJECT, SHA, model.size, "mesh")).toEqual({ uploaded: true });
    expect(mocks.assets[0]?.verifiedAt).toBeInstanceOf(Date);
  });

  it("restarts the sweep's clock when an unverified upload is retried", async () => {
    const old = new Date("2026-01-01T00:00:00Z");
    mocks.assets.push({
      projectId: PROJECT,
      sha256: SHA,
      size: model.size,
      verifiedAt: null,
      createdAt: old,
    });
    expect(await requestAssetUpload(PROJECT, SHA, model.size, "mesh")).toHaveProperty("upload");
    expect(mocks.assets[0]?.createdAt?.getTime()).toBeGreaterThan(old.getTime());
  });

  it("replaces stored bytes that don't match", async () => {
    upload(model.size, "0".repeat(64));
    expect(await requestAssetUpload(PROJECT, SHA, model.size, "mesh")).toHaveProperty("upload");
    expect(mocks.objects.has(KEY)).toBe(false);
  });

  it("refuses files over the limit, empty files and malformed hashes", async () => {
    expect(await requestAssetUpload(PROJECT, SHA, 50_000_001, "mesh")).toEqual({
      error: { key: "Assets.tooLarge", values: { mb: 50 } },
    });
    expect(await requestAssetUpload(PROJECT, SHA, 0, "mesh")).toEqual({
      error: { key: "Assets.empty" },
    });
    expect(await requestAssetUpload(PROJECT, "../other", 10, "mesh")).toEqual({
      error: { key: "Assets.invalidHash" },
    });
    // Fonts take less (ADR-0062).
    expect(await requestAssetUpload(PROJECT, SHA, 5_000_001, "font")).toEqual({
      error: { key: "Assets.tooLarge", values: { mb: 5 } },
    });
    expect(mocks.assets).toEqual([]);
  });

  it("refuses another user's project, signed-out users and servers without storage", async () => {
    mocks.projects = [{ id: PROJECT, userId: "someone-else" }];
    expect(await requestAssetUpload(PROJECT, SHA, model.size, "mesh")).toEqual({
      error: { key: "Projects.notFound" },
    });
    mocks.userId = null;
    expect(await requestAssetUpload(PROJECT, SHA, model.size, "mesh")).toHaveProperty("error");
    mocks.userId = USER;
    mocks.storage = false;
    expect(await requestAssetUpload(PROJECT, SHA, model.size, "mesh")).toEqual({
      error: { key: "Assets.noStorage" },
    });
    expect(mocks.assets).toEqual([]);
  });
});

describe("verifyAssetUpload", () => {
  it("marks the asset verified once the stored object matches", async () => {
    await requestAssetUpload(PROJECT, SHA, model.size, "mesh");
    expect(await verifyAssetUpload(PROJECT, SHA)).toEqual({
      error: { key: "Assets.notUploaded" },
    });
    upload();
    expect(await verifyAssetUpload(PROJECT, SHA)).toBeUndefined();
    expect(mocks.assets[0]?.verifiedAt).toBeInstanceOf(Date);
  });

  it("deletes a stored object that doesn't match and stays unverified", async () => {
    await requestAssetUpload(PROJECT, SHA, model.size, "mesh");
    upload(model.size + 1);
    expect(await verifyAssetUpload(PROJECT, SHA)).toEqual({
      error: { key: "Assets.mismatch" },
    });
    expect(mocks.objects.has(KEY)).toBe(false);
    expect(mocks.assets[0]?.verifiedAt).toBeNull();
  });

  it("refuses meshes nobody asked to upload", async () => {
    upload();
    expect(await verifyAssetUpload(PROJECT, SHA)).toEqual({
      error: { key: "Assets.notUploaded" },
    });
  });
});

describe("getAssetUrl", () => {
  it("returns a download URL for verified meshes only", async () => {
    await requestAssetUpload(PROJECT, SHA, model.size, "mesh");
    expect(await getAssetUrl(PROJECT, SHA)).toEqual({ error: { key: "Assets.notUploaded" } });
    upload();
    await verifyAssetUpload(PROJECT, SHA);
    expect(await getAssetUrl(PROJECT, SHA)).toEqual({ url: `https://storage/${KEY}?get` });
  });

  it("refuses another user's project", async () => {
    mocks.assets.push({
      projectId: PROJECT,
      sha256: SHA,
      size: model.size,
      verifiedAt: new Date(),
    });
    mocks.userId = "someone-else";
    expect(await getAssetUrl(PROJECT, SHA)).toEqual({ error: { key: "Projects.notFound" } });
  });
});

describe("discardAsset", () => {
  async function uploaded() {
    await requestAssetUpload(PROJECT, SHA, model.size, "mesh");
    upload();
    await verifyAssetUpload(PROJECT, SHA);
  }

  it("deletes a verified mesh that nothing saved refers to, row and object", async () => {
    await uploaded();
    expect(await discardAsset(PROJECT, SHA)).toBeUndefined();
    expect(mocks.assets).toEqual([]);
    expect(mocks.objects.has(KEY)).toBe(false);
    // As saves do, so neither runs between the other's check and write.
    expect(mocks.locked).toEqual([PROJECT]);
  });

  it("keeps a mesh that the saved document or a version refers to", async () => {
    await uploaded();
    mocks.referenced.set(PROJECT, new Set([`models:${SHA}`]));
    expect(await discardAsset(PROJECT, SHA)).toBeUndefined();
    expect(mocks.assets).toHaveLength(1);
    expect(mocks.objects.has(KEY)).toBe(true);
  });

  it("keeps a font that the saved document or a version lists", async () => {
    await uploaded();
    mocks.referenced.set(PROJECT, new Set([`fonts:${SHA}`]));
    expect(await discardAsset(PROJECT, SHA)).toBeUndefined();
    expect(mocks.assets).toHaveLength(1);
  });

  it("leaves storage alone when the project has no such asset", async () => {
    upload();
    expect(await discardAsset(PROJECT, SHA)).toBeUndefined();
    expect(mocks.objects.has(KEY)).toBe(true);
  });

  it("refuses another user's project", async () => {
    await uploaded();
    mocks.userId = "someone-else";
    expect(await discardAsset(PROJECT, SHA)).toEqual({ error: { key: "Projects.notFound" } });
    expect(mocks.assets).toHaveLength(1);
    expect(mocks.objects.has(KEY)).toBe(true);
  });
});
