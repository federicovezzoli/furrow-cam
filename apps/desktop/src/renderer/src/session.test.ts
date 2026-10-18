import { createProjectDocument, type ProjectDocument } from "@furrow/document";
import { model } from "@furrow/document/fixtures";
import { MAX_VERSIONS } from "@furrow/workspace/lib/versions";
import type { VersionRow } from "@furrow/workspace/lib/workspace-host";
import { describe, expect, it, vi } from "vitest";
import { type ProjectFile, readProjectFile } from "./project-file";
import { createProjectSession } from "./session";

function file(document: ProjectDocument = createProjectDocument()): ProjectFile {
  return { document, meshes: new Map(), versions: [] };
}

/** Lets queued recovery writes and deletes run. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

function widened(document: ProjectDocument, width: number): ProjectDocument {
  return { ...document, stock: { ...document.stock, width } };
}

/** `result`'s versions; throws its error otherwise. */
function listed(result: { versions: VersionRow[]; error?: never } | { error: string }) {
  if (result.error !== undefined) throw new Error(result.error);
  return result.versions;
}

function setup(start = file()) {
  const writeRecovery = vi.fn();
  const deleteRecovery = vi.fn();
  const onChange = vi.fn();
  const session = createProjectSession({
    path: "/p/Coasters.furrow",
    name: "Coasters",
    file: start,
    onChange,
    writeRecovery,
    deleteRecovery,
  });
  const versions = session.host.versions;
  if (!versions) throw new Error("expected versions");
  return { session, versions, writeRecovery, deleteRecovery, onChange };
}

describe("createProjectSession", () => {
  it("is modified once the workspace saves a change, and clean again after undoing it", async () => {
    const { session, writeRecovery, deleteRecovery, onChange } = setup();
    const original = session.document;
    await session.host.save(widened(original, 321), session.savedAt);
    await settled();
    expect(session.modified).toBe(true);
    expect(writeRecovery).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledTimes(1);

    // An undo gives back an equal document, though not the same object.
    await session.host.save(structuredClone(original), session.savedAt);
    await settled();
    expect(session.modified).toBe(false);
    expect(deleteRecovery).toHaveBeenCalledTimes(1);
  });

  it("is clean after saving, and writes what's on screen", async () => {
    const { session, deleteRecovery } = setup();
    await session.host.save(widened(session.document, 321), session.savedAt);
    const { bytes, contents } = session.prepareSave();
    session.markSaved("/p/Coasters 2.furrow", "Coasters 2", contents);
    await settled();
    expect(session).toMatchObject({
      modified: false,
      path: "/p/Coasters 2.furrow",
      name: "Coasters 2",
    });
    expect(deleteRecovery).toHaveBeenCalled();
    expect((await readProjectFile(bytes)).document.stock.width).toBe(321);
  });

  it("keeps changes made while a save was written unsaved, with their recovery copy", async () => {
    const { session, versions, writeRecovery, deleteRecovery } = setup();
    await session.host.save(widened(session.document, 321), session.savedAt);
    const { contents } = session.prepareSave();
    // The file is being written; the user goes on editing.
    await session.host.save(widened(session.document, 654), session.savedAt);
    session.markSaved("/p/Coasters.furrow", "Coasters", contents);
    await settled();
    expect(session.modified).toBe(true);
    expect(deleteRecovery).not.toHaveBeenCalled();
    expect(writeRecovery).toHaveBeenCalledTimes(3);

    const { contents: next } = session.prepareSave();
    await versions.create("during save", session.savedAt);
    session.markSaved("/p/Coasters.furrow", "Coasters", next);
    expect(session.modified).toBe(true);
  });

  it("runs recovery writes and deletes in order, and none after closing", async () => {
    const done: string[] = [];
    let release: () => void = () => {};
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const session = createProjectSession({
      path: null,
      name: "Untitled",
      file: file(),
      writeRecovery: async () => {
        await blocked;
        done.push("write");
      },
      deleteRecovery: () => {
        done.push("delete");
      },
    });
    const original = session.document;
    await session.host.save(widened(original, 321), session.savedAt);
    await session.host.save(structuredClone(original), session.savedAt);
    const closed = session.discard();
    await session.host.save(widened(original, 999), session.savedAt);
    release();
    await closed;
    expect(done).toEqual(["write", "delete", "delete"]);
  });

  it("starts modified when restored from a recovery copy", () => {
    const session = createProjectSession({
      path: null,
      name: "Untitled",
      file: file(),
      modified: true,
    });
    expect(session.modified).toBe(true);
  });

  it("keeps versions in the file across saving and opening again", async () => {
    const { session, versions } = setup();
    await versions.create("first cut", session.savedAt);
    expect(session.modified).toBe(true);
    await session.host.save(widened(session.document, 321), session.savedAt);

    const reopened = await readProjectFile(session.toFile());
    expect(reopened.versions).toMatchObject([{ label: "first cut", automatic: false }]);
    expect(reopened.versions[0]?.document.stock.width).not.toBe(321);
    expect(reopened.document.stock.width).toBe(321);
  });

  it("restores a version, keeping the replaced document as an automatic version", async () => {
    const { session, versions } = setup();
    const created = await versions.create("first cut", session.savedAt);
    if (created.error !== undefined) throw new Error(created.error);
    const [first] = created.versions;
    await session.host.save(widened(session.document, 321), session.savedAt);

    const restored = await versions.restore(first?.id ?? "", session.savedAt);
    if (restored.error !== undefined) throw new Error(restored.error);
    expect(restored.document.stock.width).not.toBe(321);
    expect(session.document).toBe(restored.document);
    expect(restored.versions.map((v) => v.label)).toEqual([
      "Before restoring “first cut”",
      "first cut",
    ]);
  });

  it("renames and deletes versions, which counts as a change", async () => {
    const { session, versions } = setup();
    const created = await versions.create("", session.savedAt);
    if (created.error !== undefined) throw new Error(created.error);
    const id = created.versions[0]?.id ?? "";
    expect(created.versions[0]?.label).toBeNull();
    session.markSaved("/p/Coasters.furrow", "Coasters", session.prepareSave().contents);

    expect(await versions.rename(id, "  final  ")).toBeUndefined();
    expect(session.modified).toBe(true);
    expect(listed(await versions.list())[0]?.label).toBe("final");
    expect(await versions.delete(id)).toBeUndefined();
    expect(listed(await versions.list())).toEqual([]);
    expect(await versions.delete(id)).toEqual({ error: "This version no longer exists." });
  });

  it("caps the versions a project keeps", async () => {
    const { session, versions } = setup();
    for (let i = 0; i < MAX_VERSIONS; i++) await versions.create(String(i), session.savedAt);
    expect(await versions.create("one more", session.savedAt)).toHaveProperty("error");
  });

  it("keeps meshes for the workspace, handing out copies", async () => {
    const { session } = setup();
    const bytes = new Uint8Array([1, 2, 3]);
    expect(await session.host.meshes.put("a", new Blob([bytes]))).toEqual({ uploaded: true });
    expect(await session.host.meshes.put("a", new Blob([bytes]))).toEqual({ uploaded: false });
    const copy = await session.host.meshes.get("a");
    expect(new Uint8Array(copy)).toEqual(bytes);
    new Uint8Array(copy)[0] = 9;
    expect(new Uint8Array(await session.host.meshes.get("a"))[0]).toBe(1);
    await session.host.meshes.discard("a");
    await expect(session.host.meshes.get("a")).rejects.toThrow(/missing/);
  });

  it("opens a version as a new project with the meshes it needs", async () => {
    const openAsProject = vi.fn();
    const session = createProjectSession({
      path: null,
      name: "Relief",
      file: file(),
      openAsProject,
    });
    const versions = session.host.versions;
    const created = await versions?.create("", session.savedAt);
    if (!created || created.error !== undefined) throw new Error("expected a version");
    await versions?.openAsProject(created.versions[0]?.id ?? "", "1 Oct 2026");
    expect(openAsProject).toHaveBeenCalledWith(
      expect.objectContaining({ versions: [] }),
      "Relief (1 Oct 2026)",
    );
  });
});

describe("readProjectFile", () => {
  it("opens a .furrow.json document, which can't carry models", async () => {
    const document = createProjectDocument();
    const read = await readProjectFile(new TextEncoder().encode(JSON.stringify(document)));
    expect(read).toEqual({ document, meshes: new Map(), versions: [] });
    await expect(
      readProjectFile(new TextEncoder().encode(JSON.stringify({ ...document, models: [model] }))),
    ).rejects.toThrow(/3D models/);
  });

  it("refuses files that aren't projects", async () => {
    await expect(readProjectFile(new TextEncoder().encode("{}"))).rejects.toThrow(
      "This file isn't a Furrow CAM project.",
    );
    await expect(readProjectFile(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0]))).rejects.toThrow();
  });

  it("refuses a document from a newer release", async () => {
    const newer = { ...createProjectDocument(), schemaVersion: 999 };
    await expect(readProjectFile(new TextEncoder().encode(JSON.stringify(newer)))).rejects.toThrow(
      /newer version of Furrow CAM/,
    );
  });
});
