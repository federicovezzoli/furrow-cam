import {
  CURRENT_SCHEMA_VERSION,
  createProjectDocument,
  type ProjectDocument,
} from "@furrow/document";
import { fullDocument } from "@furrow/document/fixtures";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@/generated/prisma/client";
import type { VersionRow as ListedVersion } from "./server";

const USER = "user-1";
const PROJECT = "00000000-0000-4000-8000-000000000001";
const LOADED_AT = new Date("2026-10-01T00:00:00Z");

type ProjectRow = {
  id: string;
  userId: string;
  name: string;
  schemaVersion: number;
  document: unknown;
  updatedAt: Date;
};
type VersionRow = {
  id: string;
  projectId: string;
  label: string | null;
  schemaVersion: number;
  document: unknown;
  createdAt: Date;
};

const mocks = vi.hoisted(() => ({
  userId: "user-1" as string | null,
  projects: [] as ProjectRow[],
  versions: [] as VersionRow[],
  /** Makes the next project update fail as if it had been saved or deleted elsewhere meanwhile. */
  raceNextUpdate: null as "saved" | "deleted" | null,
  /** Projects whose row a transaction locked. */
  locked: [] as string[],
  clock: 0,
}));

vi.mock("@/features/auth/server", () => ({ getUserId: async () => mocks.userId }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect ${url}`);
  },
}));
vi.mock("@/lib/db", () => {
  type VersionWhere = { id?: string; projectId?: string; project?: { userId: string } };
  const ownedVersions = (where: VersionWhere) =>
    mocks.versions.filter(
      (v) =>
        (where.id === undefined || v.id === where.id) &&
        (where.projectId === undefined || v.projectId === where.projectId) &&
        (where.project === undefined ||
          mocks.projects.some((p) => p.id === v.projectId && p.userId === where.project?.userId)),
    );
  const models = {
    project: {
      findFirst: async ({ where }: { where: { id: string; userId: string } }) =>
        mocks.projects.find((p) => p.id === where.id && p.userId === where.userId) ?? null,
      count: async ({ where }: { where: { id: string; userId: string } }) =>
        mocks.projects.filter((p) => p.id === where.id && p.userId === where.userId).length,
      update: async ({
        where,
        data,
      }: {
        where: { id: string; userId: string; updatedAt: Date };
        data: Partial<ProjectRow>;
      }) => {
        const row = mocks.projects.find(
          (p) =>
            p.id === where.id &&
            p.userId === where.userId &&
            p.updatedAt.getTime() === where.updatedAt.getTime() &&
            !mocks.raceNextUpdate,
        );
        if (!row) {
          throw new Prisma.PrismaClientKnownRequestError("Not found", {
            code: "P2025",
            clientVersion: "test",
          });
        }
        Object.assign(row, data, { updatedAt: new Date(LOADED_AT.getTime() + ++mocks.clock) });
        return { updatedAt: row.updatedAt };
      },
      create: async ({ data }: { data: Omit<ProjectRow, "id" | "updatedAt"> }) => {
        const id = crypto.randomUUID();
        mocks.projects.push({ ...data, id, updatedAt: new Date() });
        return { id };
      },
    },
    projectVersion: {
      findFirst: async ({ where }: { where: VersionWhere }) => {
        const version = ownedVersions(where)[0];
        if (!version) return null;
        return { ...version, project: mocks.projects.find((p) => p.id === version.projectId) };
      },
      findMany: async ({ where, select }: { where: VersionWhere; select: object }) =>
        ownedVersions(where)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .map((v) =>
            Object.fromEntries(Object.keys(select).map((key) => [key, v[key as keyof VersionRow]])),
          ),
      count: async ({ where }: { where: VersionWhere }) => ownedVersions(where).length,
      create: async ({ data }: { data: Omit<VersionRow, "id" | "createdAt"> }) => {
        mocks.versions.push({
          ...data,
          id: crypto.randomUUID(),
          createdAt: new Date(LOADED_AT.getTime() + ++mocks.clock),
        });
      },
      updateMany: async ({ where, data }: { where: VersionWhere; data: Partial<VersionRow> }) => {
        const rows = ownedVersions(where);
        for (const version of rows) Object.assign(version, data);
        return { count: rows.length };
      },
      deleteMany: async ({ where }: { where: VersionWhere }) => {
        const ids = new Set(ownedVersions(where).map((v) => v.id));
        mocks.versions = mocks.versions.filter((v) => !ids.has(v.id));
        return { count: ids.size };
      },
    },
    /** Only `lockProject`'s `SELECT … FOR UPDATE` is expected. */
    $executeRaw: async (_sql: TemplateStringsArray, projectId: string) => {
      mocks.locked.push(projectId);
      return 1;
    },
  };
  const db = {
    ...models,
    /** Rolls back the rows when `fn` throws, like a database transaction. */
    async $transaction<T>(fn: (tx: typeof models) => Promise<T>): Promise<T> {
      const projects = structuredClone(mocks.projects);
      const versions = structuredClone(mocks.versions);
      try {
        return await fn(models);
      } catch (error) {
        mocks.projects = projects;
        mocks.versions = versions;
        // The other request's write isn't rolled back with this transaction.
        if (mocks.raceNextUpdate === "deleted") {
          mocks.projects = [];
          mocks.versions = [];
        }
        mocks.raceNextUpdate = null;
        throw error;
      }
    },
  };
  return { db };
});

const {
  createVersion,
  deleteVersion,
  getVersions,
  openVersionAsProject,
  renameVersion,
  restoreVersion,
} = await import("./actions");

function documentWithWidth(width: number): ProjectDocument {
  const document = createProjectDocument();
  document.stock.width = width;
  return document;
}

function addVersion(document: unknown, label: string | null = null, projectId = PROJECT) {
  const id = crypto.randomUUID();
  mocks.versions.push({
    id,
    projectId,
    label,
    schemaVersion: (document as { schemaVersion: number }).schemaVersion,
    document,
    createdAt: new Date(LOADED_AT.getTime() - mocks.versions.length - 1),
  });
  return id;
}

const project = () => mocks.projects[0] as ProjectRow;

/** The versions an action returned; fails the test on an error. */
function versionsOf(result: { versions: ListedVersion[] } | { error: string }) {
  if ("error" in result) throw new Error(result.error);
  return result.versions;
}

beforeEach(() => {
  mocks.userId = USER;
  mocks.raceNextUpdate = null;
  mocks.locked = [];
  mocks.clock = 0;
  mocks.projects = [
    {
      id: PROJECT,
      userId: USER,
      name: "Shelf",
      schemaVersion: CURRENT_SCHEMA_VERSION,
      document: documentWithWidth(100),
      updatedAt: LOADED_AT,
    },
  ];
  mocks.versions = [];
});

describe("createVersion", () => {
  it("copies the stored document, with an optional label", async () => {
    const result = await createVersion(PROJECT, "  First pass ", LOADED_AT);
    expect(versionsOf(result)).toEqual([
      { id: expect.any(String), label: "First pass", createdAt: expect.any(Date) },
    ]);
    expect(mocks.versions[0]?.document).toEqual(documentWithWidth(100));

    await createVersion(PROJECT, " ", LOADED_AT);
    expect(mocks.versions[1]?.label).toBeNull();
  });

  it("creates nothing when the project was saved elsewhere since", async () => {
    const result = await createVersion(PROJECT, "", new Date("2026-09-01T00:00:00Z"));
    expect(result.error).toMatch(/changed somewhere else/);
    expect(mocks.versions).toHaveLength(0);
  });

  it("refuses another user's project", async () => {
    mocks.userId = "user-2";
    expect(await createVersion(PROJECT, "", LOADED_AT)).toEqual({
      error: "This project no longer exists.",
    });
  });

  it("refuses a 51st version", async () => {
    for (let i = 0; i < 50; i++) addVersion(documentWithWidth(i));
    expect((await createVersion(PROJECT, "", LOADED_AT)).error).toMatch(/already has 50 versions/);
    expect(mocks.versions).toHaveLength(50);
    // Counted with the project's row locked, so concurrent writes can't both pass.
    expect(mocks.locked).toEqual([PROJECT]);
  });
});

describe("restoreVersion", () => {
  it("keeps the current document as an automatic version and replaces it", async () => {
    const id = addVersion(documentWithWidth(42), "First pass");
    const result = await restoreVersion(id, LOADED_AT);
    if (result.error !== undefined) throw new Error(result.error);

    expect(result.document).toEqual(documentWithWidth(42));
    expect(project().document).toEqual(documentWithWidth(42));
    expect(result.updatedAt).toEqual(project().updatedAt);
    expect(result.updatedAt).not.toEqual(LOADED_AT);
    expect(result.versions.map((v) => v.label)).toEqual([
      "Before restoring “First pass”",
      "First pass",
    ]);
    const automatic = mocks.versions.find((v) => v.label?.startsWith("Before"));
    expect(automatic?.document).toEqual(documentWithWidth(100));
  });

  it("names the automatic version of an unlabelled one generically", async () => {
    const id = addVersion(documentWithWidth(42));
    const result = await restoreVersion(id, LOADED_AT);
    expect(versionsOf(result)[0]?.label).toBe("Before restoring an earlier version");
  });

  it("changes nothing when the project was saved elsewhere since", async () => {
    const id = addVersion(documentWithWidth(42));
    const result = await restoreVersion(id, new Date("2026-09-01T00:00:00Z"));
    expect(result.error).toMatch(/changed somewhere else/);
    expect(project().document).toEqual(documentWithWidth(100));
    expect(mocks.versions).toHaveLength(1);
  });

  it("rolls the automatic version back when the project is saved during the restore", async () => {
    const id = addVersion(documentWithWidth(42));
    mocks.raceNextUpdate = "saved";
    const result = await restoreVersion(id, LOADED_AT);
    expect(result.error).toMatch(/changed somewhere else/);
    expect(project().document).toEqual(documentWithWidth(100));
    expect(mocks.versions).toHaveLength(1);
  });

  it("upgrades a version saved with an older schema version", async () => {
    const current = fullDocument();
    const { entryClearance: _, ...machine } = current.machine ?? {};
    const id = addVersion({ ...current, schemaVersion: 2, machine });
    const result = await restoreVersion(id, LOADED_AT);
    if (result.error !== undefined) throw new Error(result.error);

    expect(result.document.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(result.document.machine).toEqual({ ...machine, entryClearance: 1 });
    expect(project().schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });

  it("refuses a version saved by a newer release, and lists why", async () => {
    const newer = CURRENT_SCHEMA_VERSION + 1;
    const id = addVersion({ ...documentWithWidth(42), schemaVersion: newer });
    const result = await restoreVersion(id, LOADED_AT);
    const message = `This version can't be restored: it was saved by a newer version of Furrow CAM (document version ${newer}; this version reads up to ${CURRENT_SCHEMA_VERSION}).`;
    expect(result).toEqual({ error: message });
    expect(versionsOf(await getVersions(PROJECT))[0]?.error).toBe(message);
    expect(project().document).toEqual(documentWithWidth(100));
  });

  it("refuses a version whose contents are invalid", async () => {
    const id = addVersion({ ...documentWithWidth(42), stock: null });
    expect(await restoreVersion(id, LOADED_AT)).toEqual({
      error: "This version can't be restored: its contents are invalid.",
    });
    expect(mocks.versions).toHaveLength(1);
  });

  it("refuses at the version cap, since the automatic version counts", async () => {
    for (let i = 0; i < 49; i++) addVersion(documentWithWidth(i));
    const id = addVersion(documentWithWidth(42));
    expect((await restoreVersion(id, LOADED_AT)).error).toMatch(/already has 50 versions/);
    expect(project().document).toEqual(documentWithWidth(100));
    expect(mocks.locked).toEqual([PROJECT]);
  });

  it("says the project is gone when it's deleted during the restore", async () => {
    const id = addVersion(documentWithWidth(42));
    mocks.raceNextUpdate = "deleted";
    expect(await restoreVersion(id, LOADED_AT)).toEqual({
      error: "This project no longer exists.",
    });
  });

  it("refuses another user's version", async () => {
    const id = addVersion(documentWithWidth(42));
    mocks.userId = "user-2";
    expect(await restoreVersion(id, LOADED_AT)).toEqual({
      error: "This version no longer exists.",
    });
  });
});

describe("managing versions", () => {
  it("renames and deletes the user's versions only", async () => {
    const id = addVersion(documentWithWidth(42), "Old");
    expect(await renameVersion(id, " New ")).toBeUndefined();
    expect(mocks.versions[0]?.label).toBe("New");
    await renameVersion(id, "");
    expect(mocks.versions[0]?.label).toBeNull();

    mocks.userId = "user-2";
    const gone = { error: "This version no longer exists." };
    expect(await renameVersion(id, "Mine")).toEqual(gone);
    expect(await deleteVersion(id)).toEqual(gone);
    expect(mocks.versions).toHaveLength(1);
    mocks.userId = USER;
    expect(await deleteVersion(id)).toBeUndefined();
    expect(mocks.versions).toHaveLength(0);
  });

  it("opens a version as a new project named after it", async () => {
    const labelled = addVersion(documentWithWidth(42), "First pass");
    await expect(openVersionAsProject(labelled, "15 Oct 2026")).rejects.toThrow(/redirect/);
    expect(mocks.projects[1]).toMatchObject({ name: "Shelf (First pass)", userId: USER });
    expect(mocks.projects[1]?.document).toEqual(documentWithWidth(42));

    const unlabelled = addVersion(documentWithWidth(7));
    await expect(openVersionAsProject(unlabelled, "15 Oct 2026")).rejects.toThrow(/redirect/);
    expect(mocks.projects[2]?.name).toBe("Shelf (15 Oct 2026)");
  });

  it("shortens a long project name, not the label, to keep the name within limits", async () => {
    project().name = "N".repeat(95);
    const id = addVersion(documentWithWidth(42), "First pass");
    await expect(openVersionAsProject(id, "")).rejects.toThrow(/redirect/);
    expect(mocks.projects[1]?.name).toBe(`${"N".repeat(87)} (First pass)`);
  });

  it("names an unlabelled version without a usable date after its project alone", async () => {
    const id = addVersion(documentWithWidth(42));
    await expect(openVersionAsProject(id, "x".repeat(101))).rejects.toThrow(/redirect/);
    expect(mocks.projects[1]?.name).toBe("Shelf");
  });
});
