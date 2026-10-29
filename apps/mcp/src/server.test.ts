import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProjectDocument, packProjectArchive } from "@furrow/document";
import { fullDocument, model } from "@furrow/document/fixtures";
import { readProjectFile } from "@furrow/workspace/lib/project-file";
import { MAX_VERSIONS } from "@furrow/workspace/lib/versions";
import { setStockDimension } from "@furrow/workspace/stores/stock-actions";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeFileAtomic } from "./files";
import { change, createProjects, KEPT_VERSION_LABEL, type Projects, t } from "./projects";
import { createServer } from "./server";

let dir: string;
let projects: Projects;
let client: Client;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "furrow-mcp-"));
  projects = createProjects();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await createServer(projects).connect(serverTransport);
  client = new Client({ name: "test", version: "0" });
  await client.connect(clientTransport);
});

afterEach(async () => {
  await client.close();
  await rm(dir, { recursive: true, force: true });
});

/** The tool's JSON result; fails on a tool error. */
async function call(name: string, args: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: args });
  const [content] = result.content as { type: "text"; text: string }[];
  if (result.isError) throw new Error(content?.text);
  return JSON.parse(content?.text ?? "null");
}

/** The tool error's message; fails if the tool succeeds. */
async function refusal(name: string, args: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: args });
  expect(result.isError).toBe(true);
  return (result.content as { text: string }[])[0]?.text;
}

async function readProject(path: string) {
  return readProjectFile(new Uint8Array(await readFile(path)), t);
}

describe("the MCP server", () => {
  it("lists its tools", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "create_project",
      "get_project",
      "open_project",
      "save_project",
    ]);
  });

  it("creates an empty .furrow project, and won't replace a file", async () => {
    const path = join(dir, "Sign.furrow");
    const summary = await call("create_project", { path });
    expect(summary).toMatchObject({ path, units: "mm", operations: [] });
    expect((await readProject(path)).document).toEqual(createProjectDocument());
    expect(await refusal("create_project", { path })).toContain("already exists");
  });

  it("refuses relative paths and other files", async () => {
    expect(await refusal("get_project", { path: "Sign.furrow" })).toContain("absolute path");
    expect(await refusal("get_project", { path: join(dir, "sign.svg") })).toContain(
      "isn't a project file",
    );
    expect(await refusal("create_project", { path: join(dir, "notes.json") })).toContain(
      "isn't a project file",
    );
    expect(await refusal("get_project", { path: join(dir, "missing.furrow") })).toContain(
      "Can't read",
    );
  });

  it("reports a project that can't be opened with the app's message", async () => {
    const path = join(dir, "broken.furrow.json");
    await writeFile(path, "{}");
    expect(await refusal("open_project", { path })).toBe(t("ProjectFile.notAProject"));
  });

  it("summarises a project in millimetres and its units", async () => {
    const path = join(dir, "Part.furrow.json");
    await writeFile(path, JSON.stringify(fullDocument()));
    const summary = await call("get_project", { path });
    expect(summary).toMatchObject({ path, savesTo: join(dir, "Part.furrow") });
    expect(summary.units).toBe("in");
    expect(summary.stock).toMatchObject({
      width: 300,
      xyOrigin: { anchor: "center" },
      inProjectUnits: { size: "11.811 in × 7.874 in × 0.7087 in", xyOrigin: "center" },
    });
    expect(summary.drawings[0]).toMatchObject({ name: "part.dxf", shapes: [{}, {}] });
    expect(summary.drawings[0].bounds).toEqual({ min: expect.any(Array), max: expect.any(Array) });
    expect(summary.operations).toEqual(fullDocument().operations);
  });

  it("saves a project opened from an export as .furrow next to it, never over another file", async () => {
    const path = join(dir, "Part.furrow.json");
    await writeFile(path, JSON.stringify(fullDocument()));
    expect(await call("save_project", { path })).toEqual({ saved: join(dir, "Part.furrow") });
    expect((await readProject(join(dir, "Part.furrow"))).document).toEqual(fullDocument());
    // Opened again from the export, the .furrow file is no longer its own.
    await call("open_project", { path });
    expect(await refusal("save_project", { path })).toContain("already exists");
    expect(await refusal("save_project", { path, saveAs: join(dir, "Part.furrow") })).toContain(
      "already exists",
    );
    expect(await call("save_project", { path, saveAs: join(dir, "Copy.furrow") })).toEqual({
      saved: join(dir, "Copy.furrow"),
    });
    // The project now saves to its copy.
    expect(await call("save_project", { path: join(dir, "Copy.furrow") })).toEqual({
      saved: join(dir, "Copy.furrow"),
    });
    expect((await readdir(dir)).sort()).toEqual(["Copy.furrow", "Part.furrow", "Part.furrow.json"]);
  });

  it("keeps a project apart from its export of the same name", async () => {
    const exported = join(dir, "Part.furrow.json");
    await writeFile(exported, JSON.stringify(fullDocument()));
    await writeFile(
      join(dir, "Part.furrow"),
      packProjectArchive(createProjectDocument(), new Map()),
    );
    expect((await call("open_project", { path: join(dir, "Part.furrow") })).units).toBe("mm");
    expect((await call("get_project", { path: exported })).units).toBe("in");
    expect((await call("get_project", { path: join(dir, "Part.furrow") })).units).toBe("mm");
  });

  it("won't save over its own file once it changed elsewhere", async () => {
    const path = join(dir, "Part.furrow");
    await writeFile(path, packProjectArchive(createProjectDocument(), new Map()));
    await call("open_project", { path });
    expect(await call("save_project", { path })).toEqual({ saved: path });
    // The user saves it in the app meanwhile.
    await writeFile(path, packProjectArchive(fullDocument(), new Map()));
    expect(await refusal("save_project", { path })).toContain("changed since it was opened");
    expect((await readProject(path)).document).toEqual(fullDocument());
  });

  it("saves a file with an uppercase extension to itself", async () => {
    const path = join(dir, "Part.FURROW");
    await writeFile(path, packProjectArchive(createProjectDocument(), new Map()));
    expect(await call("save_project", { path })).toEqual({ saved: path });
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
    await call("save_project", { path });
    const saved = await readProject(path);
    expect(saved.document).toEqual(document);
    expect(saved.meshes.get(model.sha256)).toEqual(mesh);
    expect(saved.versions).toEqual([version]);
  });
});

describe("change", () => {
  it("keeps the document as an automatic version before the first change only", async () => {
    const path = join(dir, "Part.furrow");
    await writeFile(path, packProjectArchive(createProjectDocument(), new Map()));
    const project = await projects.get(path);
    change(project, () => {});
    expect(project.versions).toEqual([]);
    change(project, (store) => setStockDimension(store, "width", 321));
    change(project, (store) => setStockDimension(store, "width", 322));
    await call("save_project", { path });

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

  it("refuses a change with no room for the version", async () => {
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

describe("writeFileAtomic", () => {
  it("never replaces a file unless asked, and leaves no temporary file", async () => {
    const path = join(dir, "Part.furrow");
    await writeFileAtomic(path, new TextEncoder().encode("first"), false);
    await expect(
      writeFileAtomic(path, new TextEncoder().encode("second"), false),
    ).rejects.toMatchObject({ code: "EEXIST" });
    expect(await readFile(path, "utf8")).toBe("first");
    await writeFileAtomic(path, new TextEncoder().encode("third"));
    expect(await readFile(path, "utf8")).toBe("third");
    expect(await readdir(dir)).toEqual(["Part.furrow"]);
  });
});
