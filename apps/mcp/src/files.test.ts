import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeFileAtomic } from "./files";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "furrow-mcp-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
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
