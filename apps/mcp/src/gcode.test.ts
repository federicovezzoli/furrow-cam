import { lstat, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createProjectDocument,
  type ProjectDocument,
  packProjectArchive,
  sha256Hex,
} from "@furrow/document";
import { drill, fullDocument } from "@furrow/document/fixtures";
import { setStockDimension } from "@furrow/workspace/stores/stock-actions";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import pyramidStl from "../../../packages/post/src/e2e/fixtures/pyramid.stl?raw";
import { corpus } from "../../../packages/post/src/e2e/projects";
import { checkProject, exportProject } from "./gcode";
import { createProjects } from "./projects";

/** Which `writeFileAtomic` call fails, counting from 1, or 0 for none. */
let failingWrite = 0;
vi.mock("./files", async (actual) => {
  const files = await actual<typeof import("./files")>();
  let calls = 0;
  return {
    writeFileAtomic: (...args: Parameters<typeof files.writeFileAtomic>) => {
      if (failingWrite === 0) calls = 0;
      else if (++calls === failingWrite) return Promise.reject(new Error("disk full"));
      return files.writeFileAtomic(...args);
    },
  };
});

/** `fullDocument`, which is two-sided, with its operation on both sides. */
function bothSides(): ProjectDocument {
  const document = fullDocument();
  const [top] = document.operations;
  if (!top) throw new Error("The fixture has no operation");
  const bottom = {
    ...top,
    id: "9b1d2c3e-4f5a-4b6c-8d7e-0f1a2b3c4d5e",
    stockSide: "bottom" as const,
  };
  document.operations = [top, bottom];
  return document;
}

/** Writes `document` as `name` in the test's folder; returns its path. */
async function project(document: ProjectDocument, name = "Part.furrow") {
  const path = join(dir, name);
  await writeFile(path, packProjectArchive(document, new Map()));
  return path;
}

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "furrow-mcp-"));
});

afterEach(async () => {
  failingWrite = 0;
  await rm(dir, { recursive: true, force: true });
});

const PROGRAMS = new URL("../../../packages/post/src/e2e/programs/", import.meta.url);

describe("exportProject", () => {
  // The relief projects' model gives a made-up hash; an archive checks it, so it gets the real one.
  const mesh = Uint8Array.from(pyramidStl, (character) => character.charCodeAt(0));

  it.each(corpus())(
    "exports $name byte for byte as the app does",
    async ({ name, title, document }) => {
      const folder = join(dir, name);
      await mkdir(folder);
      const sha256 = await sha256Hex(mesh);
      const models = document.models.map((model) => ({ ...model, sha256 }));
      const meshes = new Map(models.length > 0 ? [[sha256, mesh]] : []);
      const path = join(folder, `${title}.furrow`);
      await writeFile(path, packProjectArchive({ ...document, models }, meshes));

      const progress: number[] = [];
      const project = await createProjects().get(path);
      const { files } = await exportProject(project, {}, (done) => {
        progress.push(done);
      });
      expect(files).toEqual([join(folder, `${title}.gcode`)]);
      expect(await readFile(files[0] ?? "", "utf8")).toBe(
        await readFile(new URL(`${name}.gcode`, PROGRAMS), "utf8"),
      );
      expect(progress.at(-1)).toBe(
        project.store.getState().document.operations.filter((o) => o.enabled).length,
      );
    },
  );

  it("never replaces a file unless asked", async () => {
    const path = join(dir, "Part.furrow");
    await writeFile(path, packProjectArchive(fullDocument(), new Map()));
    const project = await createProjects().get(path);
    await writeFile(join(dir, "Part-top.gcode"), "mine");
    await expect(exportProject(project, {})).rejects.toThrow("already exists");
    expect(await readFile(join(dir, "Part-top.gcode"), "utf8")).toBe("mine");
    const { files } = await exportProject(project, { overwrite: true });
    expect(files).toContain(join(dir, "Part-top.gcode"));
    expect(await readFile(join(dir, "Part-top.gcode"), "utf8")).not.toBe("mine");
  });

  it("writes into another folder, named after the project", async () => {
    const path = join(dir, "Part.furrow");
    await writeFile(path, packProjectArchive(fullDocument(), new Map()));
    const out = join(dir, "out");
    await mkdir(out);
    const { files } = await exportProject(await createProjects().get(path), { folder: out });
    expect(files.every((file) => file.startsWith(out))).toBe(true);
    await expect(
      exportProject(await createProjects().get(path), { folder: "out" }),
    ).rejects.toThrow("absolute folder");
  });

  it("writes nothing once cancelled during the last operation", async () => {
    const path = join(dir, "Part.furrow");
    await writeFile(path, packProjectArchive(fullDocument(), new Map()));
    const controller = new AbortController();
    const project = await createProjects().get(path);
    await expect(
      exportProject(
        project,
        {},
        (done, total) => {
          if (done === total) controller.abort();
        },
        controller.signal,
      ),
    ).rejects.toThrow();
    expect(await readdir(dir)).toEqual(["Part.furrow"]);
  });

  it("won't replace what isn't a file", async () => {
    const path = join(dir, "Part.furrow");
    await writeFile(path, packProjectArchive(fullDocument(), new Map()));
    await mkdir(join(dir, "Part-top.gcode"));
    await expect(
      exportProject(await createProjects().get(path), { overwrite: true }),
    ).rejects.toThrow("isn't a file");
    expect((await readdir(dir)).sort()).toEqual(["Part-top.gcode", "Part.furrow"]);
  });

  it("exports the document as it was when asked, whatever changes meanwhile", async () => {
    const [first] = corpus();
    if (!first) throw new Error("The corpus is empty");
    const folder = join(dir, first.name);
    await mkdir(folder);
    const path = join(folder, `${first.title}.furrow`);
    await writeFile(path, packProjectArchive(first.document, new Map()));
    const opened = await createProjects().get(path);
    const { files } = await exportProject(opened, {}, () => {
      setStockDimension(opened.store, "thickness", 40);
    });
    expect(await readFile(files[0] ?? "", "utf8")).toBe(
      await readFile(new URL(`${first.name}.gcode`, PROGRAMS), "utf8"),
    );
  });

  it("says in the app's words when a model's mesh is missing", async () => {
    const relief = corpus().find(({ document }) => document.models.length > 0);
    if (!relief) throw new Error("The corpus has no relief");
    const sha256 = await sha256Hex(mesh);
    const models = relief.document.models.map((model) => ({ ...model, sha256 }));
    const path = join(dir, "Relief.furrow");
    await writeFile(
      path,
      packProjectArchive({ ...relief.document, models }, new Map([[sha256, mesh]])),
    );
    const opened = await createProjects().get(path);
    opened.meshes.clear();
    await expect(exportProject(opened, {})).rejects.toThrow("doesn't hold its model's mesh");
  });

  it("writes both sides of a two-sided project, or neither", async () => {
    const path = await project(bothSides());
    failingWrite = 2;
    await expect(exportProject(await createProjects().get(path), {})).rejects.toThrow("disk full");
    expect(await readdir(dir)).toEqual(["Part.furrow"]);
    failingWrite = 0;
    const { files } = await exportProject(await createProjects().get(path), {});
    expect(files).toEqual([join(dir, "Part-top.gcode"), join(dir, "Part-bottom.gcode")]);
  });

  it("replaces a link to a file when asked, leaving the file it pointed to", async () => {
    const path = await project(fullDocument());
    await writeFile(join(dir, "elsewhere.gcode"), "mine");
    await symlink(join(dir, "elsewhere.gcode"), join(dir, "Part-top.gcode"));
    await expect(exportProject(await createProjects().get(path), {})).rejects.toThrow(
      "already exists",
    );
    await exportProject(await createProjects().get(path), { overwrite: true });
    expect((await lstat(join(dir, "Part-top.gcode"))).isFile()).toBe(true);
    expect(await readFile(join(dir, "elsewhere.gcode"), "utf8")).toBe("mine");
  });

  it("won't replace a link to a folder", async () => {
    const path = await project(fullDocument());
    await mkdir(join(dir, "folder"));
    await symlink(join(dir, "folder"), join(dir, "Part-top.gcode"));
    await expect(
      exportProject(await createProjects().get(path), { overwrite: true }),
    ).rejects.toThrow("isn't a file");
  });

  it("stops when the request is cancelled", async () => {
    const path = join(dir, "Part.furrow");
    await writeFile(path, packProjectArchive(fullDocument(), new Map()));
    const controller = new AbortController();
    controller.abort();
    await expect(
      exportProject(await createProjects().get(path), {}, undefined, controller.signal),
    ).rejects.toThrow();
  });
});

describe("checkProject", () => {
  it("says there is nothing to cut, and why, in the app's words", async () => {
    const path = join(dir, "Empty.furrow");
    await writeFile(path, packProjectArchive(createProjectDocument(), new Map()));
    expect(await checkProject(await createProjects().get(path))).toEqual({
      toolProblems: [],
      warnings: [],
      canExport: false,
      whyNot: "There are no enabled operations to export.",
    });
  });

  it("reports a tool that can't cut its operation", async () => {
    const document = fullDocument();
    const [first] = document.operations;
    if (!first) throw new Error("The fixture has no operation");
    document.operations = [{ ...first, tool: drill } as typeof first];
    const path = join(dir, "Part.furrow");
    await writeFile(path, packProjectArchive(document, new Map()));
    const result = await checkProject(await createProjects().get(path));
    expect(result.toolProblems).toEqual([expect.stringMatching(/^Outside profile: /)]);
    expect(result.canExport).toBe(false);
    // Said once, in toolProblems.
    expect(result.whyNot).toBe("An operation's tool can't cut it: see toolProblems.");
  });

  it("leaves out disabled operations, which aren't exported", async () => {
    const document = fullDocument();
    const [first] = document.operations;
    if (!first) throw new Error("The fixture has no operation");
    document.operations = [
      first,
      {
        ...first,
        id: "9b1d2c3e-4f5a-4b6c-8d7e-0f1a2b3c4d5e",
        tool: drill,
        enabled: false,
      } as typeof first,
    ];
    const result = await checkProject(await createProjects().get(await project(document)));
    expect(result).toMatchObject({ toolProblems: [], canExport: true });
  });

  it("gives the same warnings whether or not another operation has a tool problem", async () => {
    const clean = await checkProject(await createProjects().get(await project(bothSides())));
    const document = bothSides();
    const [top, bottom] = document.operations;
    if (!top || !bottom) throw new Error("No operations");
    document.operations = [
      top,
      bottom,
      {
        ...top,
        id: "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
        name: "Drilled",
        tool: drill,
      } as typeof top,
    ];
    const broken = await checkProject(
      await createProjects().get(await project(document, "Broken.furrow")),
    );
    expect(broken.canExport).toBe(false);
    expect(broken.warnings).toEqual(clean.warnings);
  });

  it("lists the files an export would write", async () => {
    const path = join(dir, "Part.furrow");
    await writeFile(path, packProjectArchive(fullDocument(), new Map()));
    const result = await checkProject(await createProjects().get(path));
    expect(result).toMatchObject({ canExport: true, toolProblems: [] });
    expect(result.files).toContain("Part-top.gcode");
  });
});
