import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProjectDocument, packProjectArchive } from "@furrow/document";
import {
  DRAWING_ID,
  endMill,
  fullDocument,
  OPERATION_ID,
  SQUARE_ID,
  vBit,
} from "@furrow/document/fixtures";
import { readProjectFile } from "@furrow/workspace/lib/project-file";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { t } from "./projects";
import { createServer } from "./server";

let dir: string;
let client: Client;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "furrow-mcp-"));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await createServer(undefined, dir).connect(serverTransport);
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

describe("the MCP server", () => {
  it("reports an export's progress to a client that asks", async () => {
    const path = join(dir, "Part.furrow");
    await writeFile(path, packProjectArchive(fullDocument(), new Map()));
    const progress: number[] = [];
    const result = await client.callTool({ name: "export_gcode", arguments: { path } }, undefined, {
      onprogress: ({ progress: done }) => progress.push(done),
    });
    expect(result.isError).toBeFalsy();
    expect(progress.at(-1)).toBe(fullDocument().operations.filter((o) => o.enabled).length);
  });

  it("lists its tools", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "add_drill",
      "add_engrave",
      "add_pocket",
      "add_profile",
      "add_relief_finish",
      "add_relief_rough",
      "add_vcarve",
      "check_project",
      "create_project",
      "edit_operation",
      "export_gcode",
      "fit_to_stock",
      "get_library",
      "get_project",
      "get_top_view",
      "import_file",
      "import_terrain",
      "move_operation",
      "open_project",
      "remove_operation",
      "resize",
      "save_project",
      "set_machine",
      "set_model_top",
      "set_operation_tool",
      "set_stock",
      "set_touch_off_pad",
      "set_two_sided",
      "set_zero",
      "turn_model",
    ]);
  });

  it("creates a project and returns its summary", async () => {
    const path = join(dir, "Sign.furrow");
    expect(await call("create_project", { path })).toMatchObject({
      path,
      savesTo: path,
      units: "mm",
      operations: [],
    });
    const file = await readProjectFile(new Uint8Array(await readFile(path)), t);
    expect(file.document).toEqual(createProjectDocument());
  });

  it("returns what it refuses as a tool error", async () => {
    expect(await refusal("get_project", { path: "Sign.furrow" })).toContain("absolute path");
    const broken = join(dir, "broken.furrow.json");
    await writeFile(broken, "{}");
    expect(await refusal("open_project", { path: broken })).toBe(t("ProjectFile.notAProject"));
    // Smaller than the app's size fields take.
    const tiny = { path: join(dir, "Part.furrow"), id: "x", side: "width", mm: 0.001 };
    expect(await refusal("resize", tiny)).toContain("mm");
  });

  it("summarises a project by the path it was opened from, and saves it as .furrow", async () => {
    const path = join(dir, "Part.furrow.json");
    await writeFile(path, JSON.stringify(fullDocument()));
    expect(await call("get_project", { path })).toMatchObject({
      path,
      savesTo: join(dir, "Part.furrow"),
      units: "in",
    });
    expect(await call("save_project", { path })).toEqual({ saved: join(dir, "Part.furrow") });
    expect(
      await call("save_project", {
        path: join(dir, "Part.furrow"),
        saveAs: join(dir, "Copy.furrow"),
      }),
    ).toEqual({ saved: join(dir, "Copy.furrow") });
  });

  it("lists the library, reporting files the app hasn't written", async () => {
    const library = await call("get_library", {});
    expect(library).toMatchObject({ tools: [], machines: [] });
    expect(library.problems).toEqual([
      expect.stringContaining("tools.json doesn't exist"),
      expect.stringContaining("machines.json doesn't exist"),
    ]);
  });

  it("sets the stock through its tool, refusing a size that isn't positive", async () => {
    const path = join(dir, "Sign.furrow");
    await call("create_project", { path });
    expect((await call("set_stock", { path, width: 300 })).stock.width).toBe(300);
    expect(await refusal("set_stock", { path, width: 0 })).toBeTruthy();
  });

  it("adds, edits, moves and removes operations through its tools", async () => {
    const path = join(dir, "Part.furrow");
    await writeFile(path, packProjectArchive(fullDocument(), new Map()));
    const added = await call("add_pocket", {
      path,
      targets: [{ drawingId: DRAWING_ID }],
      tool: endMill,
      settings: { depth: 4 },
    });
    expect(added.operations.at(-1)).toMatchObject({
      id: added.id,
      type: "pocket",
      params: { depth: 4 },
    });
    await call("edit_operation", { path, operationId: added.id, enabled: false });
    await call("move_operation", { path, operationId: added.id, index: 0 });
    const removed = await call("remove_operation", { path, operationId: OPERATION_ID });
    expect(removed.operations).toEqual([expect.objectContaining({ id: added.id, enabled: false })]);
    expect(
      await refusal("edit_operation", { path, operationId: added.id, settings: { speed: 1 } }),
    ).toMatch(/no setting "speed"/);
  });

  it("finds a flat bottom's library end mill for a V-bit given by its settings", async () => {
    const path = join(dir, "Part.furrow");
    await writeFile(path, packProjectArchive(fullDocument(), new Map()));
    await writeFile(
      join(dir, "tools.json"),
      JSON.stringify([{ id: "mill", isDefault: true, tool: endMill }]),
    );
    const added = await call("add_vcarve", {
      path,
      targets: [{ shapeId: SQUARE_ID }],
      tool: vBit,
      settings: { flatBottom: { toolId: "mill" } },
    });
    expect(added.operations.at(-1)).toMatchObject({
      params: { flatBottom: { tool: endMill } },
    });
  });

  it("returns a top view as a PNG image with its legend", async () => {
    const path = join(dir, "Part.furrow");
    await writeFile(path, packProjectArchive(fullDocument(), new Map()));
    const result = await client.callTool({ name: "get_top_view", arguments: { path } });
    const [image, legend] = result.content as [
      { type: string; mimeType: string; data: string },
      { text: string },
    ];
    expect(image).toMatchObject({ type: "image", mimeType: "image/png" });
    expect(Buffer.from(image.data, "base64").subarray(1, 4).toString()).toBe("PNG");
    expect(JSON.parse(legend.text)).toMatchObject({
      side: "top",
      operations: [{ id: OPERATION_ID, color: endMill.color }],
    });
  });

  it("saves each change to the project's own file as it's made", async () => {
    const path = join(dir, "Part.furrow");
    await writeFile(path, packProjectArchive(fullDocument(), new Map()));
    await call("set_stock", { path, width: 321 });
    const saved = await readProjectFile(new Uint8Array(await readFile(path)), t);
    expect(saved.document.stock.width).toBe(321);
  });
});
