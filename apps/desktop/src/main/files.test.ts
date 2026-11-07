import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  existingRecent,
  fileStamp,
  MAX_RECENT,
  parseRecent,
  projectName,
  projectPathsIn,
  recoveryStore,
  watchFile,
  withoutRecent,
  withRecent,
  writeFileAtomic,
} from "./files";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "furrow-desktop-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("writeFileAtomic", () => {
  it("replaces the file and leaves no temporary file behind", async () => {
    const path = join(dir, "Coasters.furrow");
    await writeFile(path, "old");
    await writeFileAtomic(path, "new");
    expect(await readFile(path, "utf8")).toBe("new");
    expect(await readdir(dir)).toEqual(["Coasters.furrow"]);
  });

  it("keeps the original when the write fails", async () => {
    const path = join(dir, "missing-folder", "Coasters.furrow");
    await expect(writeFileAtomic(path, "new")).rejects.toThrow();
    expect(await readdir(dir)).toEqual([]);
  });
});

describe("recent files", () => {
  it("moves a file to the top, once, keeping at most MAX_RECENT", () => {
    let recent = parseRecent(null);
    for (let i = 0; i < MAX_RECENT + 2; i++) recent = withRecent(recent, `/p/${i}.furrow`);
    recent = withRecent(recent, "/p/5.furrow");
    expect(recent).toHaveLength(MAX_RECENT);
    expect(recent[0]).toEqual({ path: "/p/5.furrow", name: "5" });
    expect(recent.filter((file) => file.path === "/p/5.furrow")).toHaveLength(1);
  });

  it("takes a file off the list, leaving the others in order", () => {
    const recent = ["/p/a.furrow", "/p/b.zip", "/p/c.furrow"].reduceRight(
      withRecent,
      parseRecent(null),
    );
    expect(withoutRecent(recent, "/p/b.zip").map((file) => file.path)).toEqual([
      "/p/a.furrow",
      "/p/c.furrow",
    ]);
  });

  it("reads stored lists leniently and drops files that are gone", async () => {
    const kept = join(dir, "Kept.furrow");
    await writeFile(kept, "");
    const recent = parseRecent([{ path: kept }, { path: join(dir, "Gone.furrow") }, 3, null]);
    expect(await existingRecent(recent)).toEqual([{ path: kept, name: "Kept" }]);
  });
});

describe("projectName and projectPathsIn", () => {
  it("names a project after its file", () => {
    expect(projectName("/a/Coasters.furrow")).toBe("Coasters");
    expect(projectName("/a/Relief.furrow.zip")).toBe("Relief");
    expect(projectName("/a/sign.furrow.json")).toBe("sign");
  });

  it("finds project files among command-line arguments", () => {
    expect(
      projectPathsIn(["--inspect", "/a/Coasters.furrow", "/a/notes.txt", "/a/b.furrow.zip"]),
    ).toEqual(["/a/Coasters.furrow", "/a/b.furrow.zip"]);
  });
});

describe("recoveryStore", () => {
  it("writes, lists newest first, reads and deletes copies", async () => {
    const store = recoveryStore(join(dir, "recovery"));
    await store.write(
      { id: "a", path: "/p/A.furrow", name: "A", stamp: "1:2:3:4" },
      new Uint8Array([1]),
    );
    await store.write({ id: "b", path: null, name: "Untitled" }, new Uint8Array([2]));
    const list = await store.list();
    expect(list.map((r) => r.id).sort()).toEqual(["a", "b"]);
    // The file's stamp comes back, so a restored project checks it before saving over it.
    expect(list.find((r) => r.id === "a")?.stamp).toBe("1:2:3:4");
    expect((list[0]?.savedAt ?? "") >= (list[1]?.savedAt ?? "")).toBe(true);
    expect(await store.read("b")).toEqual(new Uint8Array([2]));
    await store.delete("a");
    expect((await store.list()).map((r) => r.id)).toEqual(["b"]);
    expect(await store.read("a")).toBeNull();
  });

  it("ignores a copy without its project, and an empty folder", async () => {
    const store = recoveryStore(join(dir, "recovery"));
    expect(await store.list()).toEqual([]);
    await store.write({ id: "a", path: null, name: "A" }, new Uint8Array([1]));
    await rm(join(dir, "recovery", "a.furrow"));
    expect(await store.list()).toEqual([]);
  });

  it("refuses ids that would name files elsewhere", async () => {
    const store = recoveryStore(join(dir, "recovery"));
    await expect(store.delete("../tools")).rejects.toThrow(/Invalid recovery id/);
  });
});

describe("fileStamp", () => {
  it("changes whenever another program saves the file, even to the same size", async () => {
    const path = join(dir, "Part.furrow");
    await writeFile(path, "one");
    const read = await fileStamp(path);
    expect(await fileStamp(path)).toBe(read);
    // Another program saves it as the MCP server does: a new file renamed over it, the same size.
    await writeFileAtomic(path, "two");
    expect(await fileStamp(path)).not.toBe(read);
    await rm(path);
    expect(await fileStamp(path)).toBeNull();
  });
});

describe("watchFile", () => {
  it("reports a save over the file with its new stamp", async () => {
    const path = join(dir, "Part.furrow");
    await writeFile(path, "one");
    const stamps: (string | null)[] = [];
    const stop = watchFile(path, (stamp) => stamps.push(stamp), 20);
    try {
      // Saved as the MCP server saves: a new file renamed over it.
      await writeFileAtomic(path, "two");
      const saved = await fileStamp(path);
      // macOS may also report a change from just before the watch started.
      await expect.poll(() => stamps.at(-1), { timeout: 5000 }).toBe(saved);
    } finally {
      stop();
    }
  });
});
