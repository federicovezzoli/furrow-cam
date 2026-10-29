import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProjectDocument, packProjectArchive } from "@furrow/document";
import { fullDocument, model } from "@furrow/document/fixtures";
import { readProjectFile } from "@furrow/workspace/lib/project-file";
import { MAX_VERSIONS } from "@furrow/workspace/lib/versions";
import { setStockDimension } from "@furrow/workspace/stores/stock-actions";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { change, createProjects, KEPT_VERSION_LABEL, type Projects, savePath, t } from "./projects";

let dir: string;
let projects: Projects;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "furrow-mcp-"));
  projects = createProjects();
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function readProject(path: string) {
  return readProjectFile(new Uint8Array(await readFile(path)), t);
}

/** Writes `document` to `path` as a `.furrow` file. */
function writeProject(path: string, document = createProjectDocument()) {
  return writeFile(path, packProjectArchive(document, new Map()));
}

describe("savePath", () => {
  it("saves exports as .furrow beside them, and .furrow files to themselves", () => {
    expect(savePath("/a/Part.furrow.json")).toBe("/a/Part.furrow");
    expect(savePath("/a/Part.furrow.zip")).toBe("/a/Part.furrow");
    expect(savePath("/a/Part.FURROW")).toBe("/a/Part.FURROW");
    expect(savePath("/a/b/../Part.furrow")).toBe("/a/Part.furrow");
  });

  it("refuses relative paths and other files", () => {
    expect(() => savePath("Part.furrow")).toThrow("absolute path");
    expect(() => savePath("/a/sign.svg")).toThrow("isn't a project file");
    expect(() => savePath("/a/notes.json")).toThrow("isn't a project file");
  });
});

describe("createProjects", () => {
  it("creates an empty project, and won't replace a file", async () => {
    const path = join(dir, "Sign.furrow");
    await projects.create(path);
    expect((await readProject(path)).document).toEqual(createProjectDocument());
    await expect(projects.create(path)).rejects.toThrow("already exists");
  });

  it("reports a file it can't read", async () => {
    await expect(projects.get(join(dir, "missing.furrow"))).rejects.toThrow("Can't read");
  });

  it("saves an export as .furrow next to it, never over another file", async () => {
    const path = join(dir, "Part.furrow.json");
    await writeFile(path, JSON.stringify(fullDocument()));
    expect(await projects.save(await projects.get(path))).toBe(join(dir, "Part.furrow"));
    expect((await readProject(join(dir, "Part.furrow"))).document).toEqual(fullDocument());
    // Opened again from the export, the .furrow file is no longer its own.
    const again = await projects.open(path);
    await expect(projects.save(again)).rejects.toThrow("already exists");
    await expect(projects.save(again, join(dir, "Part.furrow"))).rejects.toThrow("already exists");
    expect(await projects.save(again, join(dir, "Copy.furrow"))).toBe(join(dir, "Copy.furrow"));
    // The project now saves to its copy, and is found by it.
    expect(await projects.get(join(dir, "Copy.furrow"))).toBe(again);
    expect(await projects.save(again)).toBe(join(dir, "Copy.furrow"));
    expect((await readdir(dir)).sort()).toEqual(["Copy.furrow", "Part.furrow", "Part.furrow.json"]);
  });

  it("keeps a project apart from its export of the same name", async () => {
    const exported = join(dir, "Part.furrow.json");
    await writeFile(exported, JSON.stringify(fullDocument()));
    await writeProject(join(dir, "Part.furrow"));
    const project = await projects.open(join(dir, "Part.furrow"));
    expect((await projects.get(exported)).store.getState().document.units).toBe("in");
    expect(await projects.get(join(dir, "Part.furrow"))).toBe(project);
  });

  it("won't save over its own file once it changed elsewhere", async () => {
    const path = join(dir, "Part.furrow");
    await writeProject(path);
    const project = await projects.open(path);
    expect(await projects.save(project)).toBe(path);
    // The user saves it in the app meanwhile.
    await writeProject(path, fullDocument());
    await expect(projects.save(project)).rejects.toThrow("changed since it was opened");
    expect((await readProject(path)).document).toEqual(fullDocument());
  });

  it("saves a file with an uppercase extension to itself", async () => {
    const path = join(dir, "Part.FURROW");
    await writeProject(path);
    expect(await projects.save(await projects.get(path))).toBe(path);
    expect(await readdir(dir)).toEqual(["Part.FURROW"]);
  });

  it("round-trips meshes and versions", async () => {
    const path = join(dir, "Relief.furrow");
    const document = { ...createProjectDocument(), models: [model] };
    const mesh = new TextEncoder().encode("test");
    const version = {
      id: "v1",
      label: "First",
      createdAt: new Date("2026-01-01T00:00:00Z"),
      automatic: false,
      document,
    };
    await writeFile(path, packProjectArchive(document, new Map([[model.sha256, mesh]]), [version]));
    await projects.save(await projects.get(path));
    const saved = await readProject(path);
    expect(saved.document).toEqual(document);
    expect(saved.meshes.get(model.sha256)).toEqual(mesh);
    expect(saved.versions).toEqual([version]);
  });
});

describe("change", () => {
  it("keeps the document as an automatic version before the first change only", async () => {
    const path = join(dir, "Part.furrow");
    await writeProject(path);
    const project = await projects.get(path);
    change(project, () => {});
    expect(project.versions).toEqual([]);
    change(project, (store) => setStockDimension(store, "width", 321));
    change(project, (store) => setStockDimension(store, "width", 322));
    await projects.save(project);

    const { document, versions } = await readProject(path);
    expect(document.stock.width).toBe(322);
    expect(versions).toEqual([
      expect.objectContaining({
        label: KEPT_VERSION_LABEL,
        automatic: true,
        document: createProjectDocument(),
      }),
    ]);
    // A new session keeps one again.
    const reopened = await projects.open(path);
    change(reopened, (store) => setStockDimension(store, "width", 400));
    expect(reopened.versions).toHaveLength(2);
  });

  it("refuses a change with no room for the version, and undoes it", async () => {
    const path = join(dir, "Full.furrow");
    const document = createProjectDocument();
    const versions = Array.from({ length: MAX_VERSIONS }, (_, i) => ({
      id: `v${i}`,
      label: null,
      createdAt: new Date(),
      automatic: false,
      document,
    }));
    await writeFile(path, packProjectArchive(document, new Map(), versions));
    const project = await projects.get(path);
    // Changes nothing, so needs no version.
    change(project, (store) => setStockDimension(store, "width", 600));
    expect(() => change(project, (store) => setStockDimension(store, "width", 321))).toThrow(
      t("Desktop.Session.tooManyVersions", { max: MAX_VERSIONS }),
    );
    expect(project.store.getState()).toMatchObject({
      document: { stock: { width: 600 } },
      past: [],
    });
  });

  it("needs no version on a new project", async () => {
    const project = await projects.create(join(dir, "New.furrow"));
    change(project, (store) => setStockDimension(store, "width", 321));
    expect(project.versions).toEqual([]);
  });
});
