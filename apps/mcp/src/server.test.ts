import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProjectDocument } from "@furrow/document";
import { fullDocument } from "@furrow/document/fixtures";
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
  it("lists its tools", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "create_project",
      "fit_to_stock",
      "get_library",
      "get_project",
      "import_file",
      "open_project",
      "resize",
      "save_project",
      "set_machine",
      "set_operation_tool",
      "set_stock",
      "set_touch_off_pad",
      "set_zero",
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
});
