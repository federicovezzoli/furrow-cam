import { translator } from "@furrow/ui/lib/i18n";
import "fake-indexeddb/auto";
import { CURRENT_SCHEMA_VERSION, createProjectDocument } from "@furrow/document";
import { forceCloseDatabase, IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Tests run without a document, so messages are in English.
const STORAGE_UNAVAILABLE = translator("en")("Guest.storageUnavailable");

let storage: typeof import("./storage");

beforeEach(async () => {
  // A new, empty database and a module that hasn't opened one yet.
  globalThis.indexedDB = new IDBFactory();
  vi.resetModules();
  storage = await import("./storage");
});

afterEach(() => {
  vi.useRealTimers();
});

/** Puts `record` in the projects store as an older release might have. */
async function putRaw(record: { id: string; name: string; savedAt: Date; document: unknown }) {
  // Opens the database at the module's version, creating its stores.
  await storage.listGuestProjects();
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("furrow-guest");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("projects", "readwrite");
    tx.objectStore("projects").put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

describe("guest projects", () => {
  it("creates, lists, reads, renames and deletes projects", async () => {
    const document = createProjectDocument();
    const created = await storage.createGuestProject("Coasters", document);
    expect(await storage.getGuestProject(created.id)).toEqual({ ...created, document });

    await storage.renameGuestProject(created.id, "Trivets");
    expect(await storage.listGuestProjects()).toEqual([
      { id: created.id, name: "Trivets", savedAt: created.savedAt },
    ]);

    await storage.deleteGuestProject(created.id);
    expect(await storage.listGuestProjects()).toEqual([]);
    expect(await storage.getGuestProject(created.id)).toBeNull();
  });

  it("lists the last saved project first", async () => {
    // Only `Date` is faked: IndexedDB's own timers keep running.
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-19T08:00:00Z") });
    const first = await storage.createGuestProject("First", createProjectDocument());
    vi.setSystemTime(new Date("2026-10-19T08:01:00Z"));
    const second = await storage.createGuestProject("Second", createProjectDocument());
    vi.setSystemTime(new Date("2026-10-19T08:02:00Z"));
    const saved = await storage.saveGuestProject(first.id, createProjectDocument(), first.savedAt);
    expect(saved).toHaveProperty("updatedAt");
    expect((await storage.listGuestProjects()).map(({ id }) => id)).toEqual([first.id, second.id]);
  });

  it("saves over the copy it was given, and refuses a stale save", async () => {
    const created = await storage.createGuestProject("Coasters", createProjectDocument());
    const changed = { ...createProjectDocument(), units: "in" as const };
    const saved = await storage.saveGuestProject(created.id, changed, created.savedAt);
    if ("error" in saved) throw new Error(saved.error);
    expect(saved.updatedAt.getTime()).toBeGreaterThan(created.savedAt.getTime());
    expect((await storage.getGuestProject(created.id))?.document).toEqual(changed);

    // Another tab still holding the first copy.
    expect(
      await storage.saveGuestProject(created.id, createProjectDocument(), created.savedAt),
    ).toEqual({ error: expect.stringContaining("another tab") });
    expect((await storage.getGuestProject(created.id))?.document).toEqual(changed);
  });

  it("deletes a project only while it is as saved at the time given", async () => {
    const created = await storage.createGuestProject("Coasters", createProjectDocument());
    const saved = await storage.saveGuestProject(
      created.id,
      createProjectDocument(),
      created.savedAt,
    );
    if ("error" in saved) throw new Error(saved.error);
    expect(await storage.deleteGuestProjectIfSaved(created.id, created.savedAt)).toBe(false);
    expect(await storage.listGuestProjects()).toHaveLength(1);
    expect(await storage.deleteGuestProjectIfSaved(created.id, saved.updatedAt)).toBe(true);
    expect(await storage.listGuestProjects()).toEqual([]);
  });

  it("refuses to save a deleted project or an invalid document", async () => {
    const created = await storage.createGuestProject("Coasters", createProjectDocument());
    const invalid = { ...createProjectDocument(), units: "cubits" } as never;
    // Undoing the edit makes it valid again, so autosave tries again.
    expect(await storage.saveGuestProject(created.id, invalid, created.savedAt)).toEqual({
      error: expect.stringContaining("invalid"),
      retryable: true,
    });
    await storage.deleteGuestProject(created.id);
    expect(
      await storage.saveGuestProject(created.id, createProjectDocument(), created.savedAt),
    ).toEqual({ error: expect.stringContaining("no longer exists") });
  });

  it("upgrades a document saved by an older release when reading it", async () => {
    const { schemaVersion: _, ...current } = createProjectDocument();
    await putRaw({
      id: "old",
      name: "Old",
      savedAt: new Date(),
      document: { ...current, schemaVersion: 1 },
    });
    // Whatever version 1 lacked is filled in by the migrations.
    const project = await storage.getGuestProject("old");
    expect(project?.document.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });

  it("explains a document saved by a newer release instead of opening it", async () => {
    await putRaw({
      id: "new",
      name: "New",
      savedAt: new Date(),
      document: { ...createProjectDocument(), schemaVersion: CURRENT_SCHEMA_VERSION + 1 },
    });
    await expect(storage.getGuestProject("new")).rejects.toThrow("newer release");
    // The project list still shows it.
    expect(await storage.listGuestProjects()).toHaveLength(1);
  });
});

describe("guest meshes", () => {
  it("stores a project's files once and deletes them with the project", async () => {
    const project = await storage.createGuestProject("Relief", createProjectDocument());
    const file = new Blob([new Uint8Array([1, 2, 3])]);
    expect(await storage.putGuestMesh(project.id, "abc", file)).toEqual({ uploaded: true });
    expect(await storage.putGuestMesh(project.id, "abc", file)).toEqual({ uploaded: false });
    expect(new Uint8Array(await storage.getGuestMesh(project.id, "abc"))).toEqual(
      new Uint8Array([1, 2, 3]),
    );

    await storage.deleteGuestProject(project.id);
    await expect(storage.getGuestMesh(project.id, "abc")).rejects.toThrow("missing");
  });

  it("keeps each project's files apart", async () => {
    const file = new Blob([new Uint8Array([1])]);
    const a = await storage.createGuestProject("A", createProjectDocument());
    const b = await storage.createGuestProject("B", createProjectDocument());
    await storage.putGuestMesh(a.id, "abc", file);
    await storage.putGuestMesh(b.id, "abc", file);
    await storage.deleteGuestMesh(a.id, "abc");
    await expect(storage.getGuestMesh(a.id, "abc")).rejects.toThrow("missing");
    expect((await storage.getGuestMesh(b.id, "abc")).byteLength).toBe(1);
  });

  it("refuses a file for a project deleted meanwhile", async () => {
    const project = await storage.createGuestProject("Relief", createProjectDocument());
    await storage.deleteGuestProject(project.id);
    await expect(
      storage.putGuestMesh(project.id, "abc", new Blob([new Uint8Array([1])])),
    ).rejects.toThrow("no longer exists");
    await expect(storage.getGuestMesh(project.id, "abc")).rejects.toThrow("missing");
  });
});

describe("guest settings", () => {
  it("start with no tour seen, and remember what was saved", async () => {
    const settings = await storage.readGuestSettings();
    expect(settings.workspaceTourDone).toBe(false);
    await storage.saveGuestSettings({ ...settings, workspaceTourDone: true });
    expect((await storage.readGuestSettings()).workspaceTourDone).toBe(true);
  });

  it("remember the last opened project", async () => {
    expect(await storage.readLastGuestProjectId()).toBeNull();
    await storage.saveLastGuestProjectId("p1");
    expect(await storage.readLastGuestProjectId()).toBe("p1");
  });
});

describe("a connection the browser closes", () => {
  it("is reopened by the next call", async () => {
    const requests: IDBOpenDBRequest[] = [];
    const open = indexedDB.open.bind(indexedDB);
    vi.spyOn(indexedDB, "open").mockImplementation((...args) => {
      const request = open(...args);
      requests.push(request);
      return request;
    });
    const created = await storage.createGuestProject("Coasters", createProjectDocument());
    // As when site data is cleared while the page stays open.
    // fake-indexeddb types the connection as the `IDBDatabase` class rather than an instance.
    forceCloseDatabase(requests[0]?.result as unknown as typeof IDBDatabase);
    expect(await storage.listGuestProjects()).toEqual([
      { id: created.id, name: "Coasters", savedAt: created.savedAt },
    ]);
    expect(requests).toHaveLength(2);
  });
});

describe("unavailable storage", () => {
  it("rejects with a message for the user", async () => {
    globalThis.indexedDB = {
      open: () => {
        throw new DOMException("blocked", "SecurityError");
      },
    } as unknown as IDBFactory;
    await expect(storage.listGuestProjects()).rejects.toThrow(STORAGE_UNAVAILABLE);
    await expect(storage.saveGuestSettings(await settingsFallback())).rejects.toThrow(
      STORAGE_UNAVAILABLE,
    );
  });

  it("refuses a save for good: retrying in this tab can't help", async () => {
    globalThis.indexedDB = {
      open: () => {
        throw new DOMException("blocked", "SecurityError");
      },
    } as unknown as IDBFactory;
    expect(await storage.saveGuestProject("id", createProjectDocument(), new Date())).toEqual({
      error: STORAGE_UNAVAILABLE,
    });
  });
});

async function settingsFallback() {
  const { parseSettings } = await import("@furrow/workspace/lib/local-library");
  return parseSettings(undefined);
}
