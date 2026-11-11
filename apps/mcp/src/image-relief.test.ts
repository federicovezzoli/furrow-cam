import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { imageDecoder } from "./decoders";
import { importImageRelief } from "./image-relief";
import { createProjects, type Project, ToolError } from "./projects";

/** A 40 × 20 PNG and JPEG, black on their left half and white on their right. */
let png: ArrayBuffer;
let jpeg: ArrayBuffer;

beforeAll(async () => {
  // The decoder compiles the codec's WebAssembly, which the encoder then shares.
  await imageDecoder("png");
  const { default: encode } = await import("@jsquash/png/encode.js");
  const data = new Uint8ClampedArray(40 * 20 * 4);
  for (let p = 0; p < 40 * 20; p++) {
    const grey = p % 40 < 20 ? 0 : 255;
    data.set([grey, grey, grey, 255], p * 4);
  }
  const image = { width: 40, height: 20, data, colorSpace: "srgb" } as ImageData;
  png = await encode(image);
  const jpegEncoder = await import("@jsquash/jpeg/encode.js");
  const wasm = createRequire(import.meta.url).resolve("@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm");
  await jpegEncoder.init(await WebAssembly.compile(await readFile(wasm)));
  jpeg = await jpegEncoder.default(image);
});

let dir: string;
let project: Project;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "furrow-mcp-"));
  project = await createProjects().create(join(dir, "Logo.furrow"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const settings = { relief: 4, base: 2, invert: false, blur: 0 };

/** The message of the `ToolError` `run` throws. */
async function refusal(run: Promise<unknown>) {
  const error = await run.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(ToolError);
  return (error as ToolError).message;
}

describe("importImageRelief", () => {
  it("adds the image's relief as the project's model, centred on the stock", async () => {
    const image = join(dir, "Logo.png");
    await writeFile(image, new Uint8Array(png));
    const result = await importImageRelief(project, { image, width: 100, ...settings });
    expect(result).toMatchObject({ size: [100, 50, 6], pixels: [40, 20], cells: [39, 19] });
    const [model] = project.store.getState().document.models;
    expect(model).toMatchObject({
      id: result.id,
      fileName: "Logo.stl",
      triangles: result.triangles,
    });
    expect(project.meshes.size).toBe(1);
    // A project holds one model.
    expect(await refusal(importImageRelief(project, { image, ...settings }))).toMatch(/model/);
  });

  it("reads a JPEG", async () => {
    const image = join(dir, "Photo.jpg");
    await writeFile(image, new Uint8Array(jpeg));
    const result = await importImageRelief(project, { image, width: 100, ...settings });
    expect(result).toMatchObject({ pixels: [40, 20], cells: [39, 19] });
    // Lossy, but white stays near white: the right edge stands at about base + relief.
    expect(result.size[2]).toBeGreaterThan(5.8);
  });

  it("refuses a file that isn't an image, and a width past the stock", async () => {
    const text = join(dir, "notes.png");
    await writeFile(text, "not an image");
    expect(await refusal(importImageRelief(project, { image: text, ...settings }))).toMatch(
      /isn't a PNG, JPEG or WebP/,
    );
    const image = join(dir, "Logo.png");
    await writeFile(image, new Uint8Array(png));
    expect(
      await refusal(importImageRelief(project, { image, width: 10_000, ...settings })),
    ).toMatch(/width can be at most/);
  });
});
