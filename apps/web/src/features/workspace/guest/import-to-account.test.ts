import "fake-indexeddb/auto";
import { DEFAULT_STL_LIMITS } from "@furrow/cam-core";
import { createProjectDocument } from "@furrow/document";
import { model } from "@furrow/document/fixtures";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";

const importGuestDocument = vi.hoisted(() => vi.fn());
const importArchive = vi.hoisted(() => vi.fn());
vi.mock("@/features/projects/actions", () => ({ importGuestDocument }));
vi.mock("@/features/projects/lib/archive-import", () => ({ importArchive }));

let storage: typeof import("./storage");
let importToAccount: typeof import("./import-to-account").importToAccount;

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory();
  vi.resetModules();
  importGuestDocument.mockReset();
  importArchive.mockReset();
  storage = await import("./storage");
  ({ importToAccount } = await import("./import-to-account"));
});

describe("importToAccount", () => {
  it("imports a project's document under its name and removes it from the browser", async () => {
    const document = { ...createProjectDocument(), units: "in" as const };
    const guest = await storage.createGuestProject("Coasters", document);
    importGuestDocument.mockResolvedValue({ projectId: "p1" });

    expect(await importToAccount([guest.id], DEFAULT_STL_LIMITS)).toEqual({
      imported: [{ id: guest.id, projectId: "p1" }],
      failed: [],
    });
    const [file, fileName] = importGuestDocument.mock.calls[0] as [File, string];
    expect(fileName).toBe("Coasters.furrow.json");
    expect(JSON.parse(await file.text())).toEqual(document);
    expect(await storage.listGuestProjects()).toEqual([]);
  });

  it("keeps a project the account refuses, with the reason, and goes on", async () => {
    const refused = await storage.createGuestProject("Refused", createProjectDocument());
    const accepted = await storage.createGuestProject("Accepted", createProjectDocument());
    importGuestDocument
      .mockResolvedValueOnce({ error: "You have too many projects." })
      .mockResolvedValueOnce({ projectId: "p2" });

    const result = await importToAccount([refused.id, accepted.id], DEFAULT_STL_LIMITS);
    expect(result).toEqual({
      imported: [{ id: accepted.id, projectId: "p2" }],
      failed: [{ id: refused.id, name: "Refused", error: "You have too many projects." }],
    });
    expect((await storage.listGuestProjects()).map(({ id }) => id)).toEqual([refused.id]);
  });

  it("keeps a project whose import fails on the way", async () => {
    const guest = await storage.createGuestProject("Coasters", createProjectDocument());
    importGuestDocument.mockRejectedValue(new TypeError(""));
    const result = await importToAccount([guest.id], DEFAULT_STL_LIMITS);
    expect(result.failed).toEqual([
      { id: guest.id, name: "Coasters", error: expect.stringContaining("connection") },
    ]);
    expect(await storage.listGuestProjects()).toHaveLength(1);
  });

  it("imports a project with 3D models as an archive with its STL files", async () => {
    const document = { ...createProjectDocument(), models: [model] };
    const guest = await storage.createGuestProject("Relief", document);
    await storage.putGuestMesh(guest.id, model.sha256, new Blob([new Uint8Array([1, 2])]));
    importArchive.mockResolvedValue({ projectId: "p3" });

    expect((await importToAccount([guest.id], DEFAULT_STL_LIMITS)).imported).toEqual([
      { id: guest.id, projectId: "p3" },
    ]);
    const [archive, fileName, machineId, limits] = importArchive.mock.calls[0] as [
      { contents: string; meshes: Map<string, Uint8Array>; versions: unknown[] },
      string,
      null,
      unknown,
    ];
    expect(JSON.parse(archive.contents)).toEqual(document);
    expect(archive.meshes.get(model.sha256)).toEqual(new Uint8Array([1, 2]));
    expect(archive.versions).toEqual([]);
    expect([fileName, machineId, limits]).toEqual(["Relief.furrow.json", null, DEFAULT_STL_LIMITS]);
    expect(importGuestDocument).not.toHaveBeenCalled();
  });

  it("keeps a project with 3D models where the account can't store them", async () => {
    const guest = await storage.createGuestProject("Relief", {
      ...createProjectDocument(),
      models: [model],
    });
    const result = await importToAccount([guest.id], null);
    expect(result.failed[0]?.error).toContain("can't store");
    expect(importArchive).not.toHaveBeenCalled();
    expect(await storage.listGuestProjects()).toHaveLength(1);
  });

  it("skips a project deleted meanwhile", async () => {
    expect(await importToAccount(["gone"], DEFAULT_STL_LIMITS)).toEqual({
      imported: [],
      failed: [],
    });
  });
});
