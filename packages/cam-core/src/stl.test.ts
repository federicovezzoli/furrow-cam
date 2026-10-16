import { describe, expect, it } from "vitest";
import { parseStl, StlImportError } from "./stl";

type Triangle = [number, number, number][];

/** Node and browsers have `TextEncoder`; the package's lib types don't include it. */
const encoder = new (
  globalThis as unknown as { TextEncoder: new () => { encode(text: string): Uint8Array } }
).TextEncoder();
const encode = (text: string) => encoder.encode(text);

/** A unit pyramid's four sides over its 1 × 1 base, apex at `z = 1`. */
const PYRAMID: Triangle[] = [
  [
    [0, 0, 0],
    [1, 0, 0],
    [0.5, 0.5, 1],
  ],
  [
    [1, 0, 0],
    [1, 1, 0],
    [0.5, 0.5, 1],
  ],
  [
    [1, 1, 0],
    [0, 1, 0],
    [0.5, 0.5, 1],
  ],
  [
    [0, 1, 0],
    [0, 0, 0],
    [0.5, 0.5, 1],
  ],
];

function binaryStl(triangles: Triangle[], header = "binary"): Uint8Array {
  const bytes = new Uint8Array(84 + triangles.length * 50);
  bytes.set(encode(header).subarray(0, 80));
  const view = new DataView(bytes.buffer);
  view.setUint32(80, triangles.length, true);
  triangles.forEach((triangle, t) => {
    triangle.flat().forEach((value, i) => {
      view.setFloat32(84 + t * 50 + 12 + i * 4, value, true);
    });
  });
  return bytes;
}

function asciiStl(triangles: Triangle[]): string {
  const facets = triangles.map(
    (triangle) =>
      `  facet normal 0 0 1\n    outer loop\n${triangle
        .map((vertex) => `      vertex ${vertex.join(" ")}\n`)
        .join("")}    endloop\n  endfacet\n`,
  );
  return `solid pyramid\n${facets.join("")}endsolid pyramid\n`;
}

const PYRAMID_BOUNDS = { min: [0, 0, 0], max: [1, 1, 1] };

describe("parseStl", () => {
  it("reads a binary file", () => {
    const mesh = parseStl(binaryStl(PYRAMID));
    expect(mesh.triangles).toBe(4);
    expect(Array.from(mesh.positions)).toEqual(PYRAMID.flat(2));
    expect(mesh.bounds).toEqual(PYRAMID_BOUNDS);
  });

  it("reads a binary file whose header starts with solid", () => {
    const mesh = parseStl(binaryStl(PYRAMID, "solid exported as binary"));
    expect(mesh.triangles).toBe(4);
    expect(mesh.bounds).toEqual(PYRAMID_BOUNDS);
  });

  it("reads an ASCII file, with Windows line ends and any case", () => {
    const mesh = parseStl(encode(asciiStl(PYRAMID).replaceAll("\n", "\r\n").toUpperCase()));
    expect(mesh.triangles).toBe(4);
    expect(Array.from(mesh.positions)).toEqual(PYRAMID.flat(2));
    expect(mesh.bounds).toEqual(PYRAMID_BOUNDS);
  });

  it("reads an ASCII file with several solids and exponents", () => {
    const text = `${asciiStl(PYRAMID.slice(0, 2))}${asciiStl(PYRAMID.slice(2))}`.replace(
      "vertex 1 0 0",
      "vertex 1e0 0.0E+0 -0",
    );
    const mesh = parseStl(encode(text));
    expect(mesh.triangles).toBe(4);
    expect(mesh.bounds).toEqual(PYRAMID_BOUNDS);
  });

  it("grows past its first buffer for large ASCII files", () => {
    const many = Array.from({ length: 3000 }, (_, i) =>
      (PYRAMID[0] as Triangle).map(([x, y, z]) => [x + i, y, z] as [number, number, number]),
    );
    const mesh = parseStl(encode(asciiStl(many)));
    expect(mesh.triangles).toBe(3000);
    expect(mesh.bounds.max[0]).toBe(3000);
  });

  it("refuses files over the size limit before reading them", () => {
    const bytes = binaryStl(PYRAMID);
    expect(() => parseStl(bytes, { maxBytes: bytes.length - 1, maxTriangles: 10 })).toThrow(
      StlImportError,
    );
    expect(() => parseStl(bytes, { maxBytes: 1_000_000, maxTriangles: 10 })).not.toThrow();
  });

  it("refuses files with more triangles than allowed", () => {
    const limits = { maxBytes: 1_000_000, maxTriangles: 3 };
    expect(() => parseStl(binaryStl(PYRAMID), limits)).toThrow(/more than 3 triangles/);
    expect(() => parseStl(encode(asciiStl(PYRAMID)), limits)).toThrow(/more than 3 triangles/);
    expect(() => parseStl(binaryStl(PYRAMID), { ...limits, maxTriangles: 4 })).not.toThrow();
  });

  it("refuses empty files and files without triangles", () => {
    expect(() => parseStl(new Uint8Array())).toThrow("This file is empty.");
    expect(() => parseStl(binaryStl([]))).toThrow("This file has no triangles.");
    expect(() => parseStl(encode("solid empty\nendsolid empty\n"))).toThrow(
      "This file has no triangles.",
    );
  });

  it("refuses binary files whose size doesn't match their triangle count", () => {
    const bytes = binaryStl(PYRAMID);
    expect(() => parseStl(bytes.subarray(0, bytes.length - 10))).toThrow(StlImportError);
    expect(() => parseStl(encode("not a mesh"))).toThrow(/isn't an STL file/);
  });

  it("refuses coordinates that aren't finite numbers", () => {
    const binary = binaryStl([[[Number.NaN, 0, 0], ...(PYRAMID[0] as Triangle).slice(1)]]);
    expect(() => parseStl(binary)).toThrow(/isn't a number/);
    const ascii = asciiStl(PYRAMID).replace("vertex 1 0 0", "vertex 1 zero 0");
    expect(() => parseStl(encode(ascii))).toThrow(/isn't a number/);
  });

  it.each([
    ["a facet with two vertices", (text: string) => text.replace(/ {6}vertex 0\.5 0\.5 1\n/, "")],
    [
      "a vertex outside a facet",
      (text: string) => text.replace("solid pyramid\n", "solid\nvertex 0 0 0\n"),
    ],
    ["a vertex with two coordinates", (text: string) => text.replace("vertex 1 0 0", "vertex 1 0")],
    ["an unfinished facet", (text: string) => text.slice(0, text.lastIndexOf("endloop"))],
    ["an unknown keyword", (text: string) => text.replace("outer loop", "inner loop")],
  ])("refuses an ASCII file with %s, saying on which line", (_, damage) => {
    expect(() => parseStl(encode(damage(asciiStl(PYRAMID))))).toThrow(/damaged: .* on line \d+/);
  });
});
