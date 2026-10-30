import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { endMill, machine } from "@furrow/document/fixtures";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { libraryDir, readLibrary } from "./library";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "furrow-mcp-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("libraryDir", () => {
  it("is Electron's userData folder for Furrow CAM on each platform", () => {
    expect(libraryDir("darwin", {}, "/Users/a")).toBe(
      "/Users/a/Library/Application Support/Furrow CAM",
    );
    expect(libraryDir("win32", { APPDATA: "C:/Users/a/AppData/Roaming" }, "C:/Users/a")).toBe(
      join("C:/Users/a/AppData/Roaming", "Furrow CAM"),
    );
    expect(libraryDir("linux", {}, "/home/a")).toBe("/home/a/.config/Furrow CAM");
    expect(libraryDir("linux", { XDG_CONFIG_HOME: "/x" }, "/home/a")).toBe("/x/Furrow CAM");
  });
});

describe("readLibrary", () => {
  it("reads the tools and machines the desktop app stores", async () => {
    await writeFile(
      join(dir, "tools.json"),
      JSON.stringify([{ id: "t1", isDefault: true, tool: endMill }]),
    );
    await writeFile(join(dir, "machines.json"), JSON.stringify([{ id: "m1", machine }]));
    expect(await readLibrary(dir)).toEqual({
      tools: [{ id: "t1", isDefault: true, tool: endMill }],
      machines: [{ id: "m1", machine }],
      problems: [],
    });
  });

  it("reports missing, unreadable and invalid files and entries, without failing", async () => {
    await writeFile(
      join(dir, "tools.json"),
      JSON.stringify([
        { id: "t1", tool: endMill },
        { id: "t2", tool: { name: "broken" } },
      ]),
    );
    const partial = await readLibrary(dir);
    expect(partial.tools.map((tool) => tool.id)).toEqual(["t1"]);
    expect(partial.machines).toEqual([]);
    expect(partial.problems).toEqual([
      expect.stringContaining("1 entries left out"),
      expect.stringContaining("machines.json doesn't exist"),
    ]);

    await writeFile(join(dir, "tools.json"), "{ not json");
    await writeFile(join(dir, "machines.json"), "{}");
    const broken = await readLibrary(dir);
    expect(broken).toMatchObject({ tools: [], machines: [] });
    expect(broken.problems).toEqual([
      expect.stringContaining("tools.json can't be read"),
      expect.stringContaining("machines.json isn't a list"),
    ]);
  });
});
