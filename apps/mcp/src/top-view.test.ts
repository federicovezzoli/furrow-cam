import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import { packProjectArchive } from "@furrow/document";
import { drill, endMill, fullDocument, OPERATION_ID } from "@furrow/document/fixtures";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { computeToolpaths } from "./gcode";
import { addOperation } from "./operations";
import { createProjects, type Project } from "./projects";
import { topView } from "./top-view";

let dir: string;
let project: Project;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "furrow-mcp-"));
  const path = join(dir, "Part.furrow");
  await writeFile(path, packProjectArchive(fullDocument(), new Map()));
  project = await createProjects().get(path);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** The width, height and RGB pixels of an 8-bit RGB PNG with unfiltered rows, as `topView` writes. */
function decode(png: Uint8Array) {
  const buffer = Buffer.from(png);
  expect(buffer.subarray(0, 8)).toEqual(
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  );
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  const idat = buffer.indexOf("IDAT");
  const raw = inflateSync(buffer.subarray(idat + 4, idat + 4 + buffer.readUInt32BE(idat - 4)));
  const pixels = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    pixels.set(raw.subarray(y * (width * 3 + 1) + 1, (y + 1) * (width * 3 + 1)), y * width * 3);
  }
  return { width, height, pixels };
}

/** How many pixels are within `tolerance` of `color` (#rrggbb) in each channel. */
function count(pixels: Uint8Array, color: string, tolerance = 24) {
  const value = Number.parseInt(color.slice(1), 16);
  const target = [value >> 16, (value >> 8) & 0xff, value & 0xff];
  let n = 0;
  for (let i = 0; i < pixels.length; i += 3) {
    if (target.every((c, k) => Math.abs((pixels[i + k] as number) - c) <= tolerance)) n++;
  }
  return n;
}

async function view(side: "top" | "bottom" = "top") {
  const { document } = project.store.getState();
  return topView(document, await computeToolpaths(project, document), side);
}

describe("topView", () => {
  it("draws each operation's cutting moves in its tool's colour, fitting what reaches past the stock", async () => {
    addOperation(project, { tools: [], machines: [], problems: [] }, "drill", {
      tool: { settings: { ...drill } },
      settings: { points: [[150, 100]] },
    });
    const { png, legend } = await view();
    const { width, height, pixels } = decode(png);
    expect(Math.max(width, height)).toBe(1024);
    expect(count(pixels, endMill.color)).toBeGreaterThan(500);
    expect(count(pixels, drill.color)).toBeGreaterThan(20);
    expect(legend.operations.map((operation) => operation.id)).toEqual([
      OPERATION_ID,
      expect.any(String),
    ]);
    // The outside profile of the square at the stock's corner runs past its left edge.
    expect(legend.shown.minX).toBeLessThan(0);
    expect(legend.millimetresPerPixel).toBeGreaterThan(0);
  });

  it("draws only the operations of the side asked for", async () => {
    const { png, legend } = await view("bottom");
    expect(legend.operations).toEqual([]);
    expect(count(decode(png).pixels, endMill.color)).toBe(0);
  });
});
