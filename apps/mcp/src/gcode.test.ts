import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProjectDocument, packProjectArchive, sha256Hex } from "@furrow/document";
import { drill, fullDocument } from "@furrow/document/fixtures";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import pyramidStl from "../../../packages/post/src/e2e/fixtures/pyramid.stl?raw";
import { corpus } from "../../../packages/post/src/e2e/projects";
import { checkProject, exportProject } from "./gcode";
import { createProjects } from "./projects";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "furrow-mcp-"));
});

afterEach(async () => {
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
  });

  it("lists the files an export would write", async () => {
    const path = join(dir, "Part.furrow");
    await writeFile(path, packProjectArchive(fullDocument(), new Map()));
    const result = await checkProject(await createProjects().get(path));
    expect(result).toMatchObject({ canExport: true, toolProblems: [] });
    expect(result.files).toContain("Part-top.gcode");
  });
});
