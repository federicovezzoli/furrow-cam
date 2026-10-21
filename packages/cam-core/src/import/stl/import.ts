import type { Box3 } from "../../scene/stock";
import type { ImportMessage, ImportMessageCode } from "../messages";

/** Thrown for a file that isn't an STL mesh Furrow CAM can import. */
export class StlImportError extends Error {
  /** Why, for the UI to translate (ADR-0054); the `message` is its code. */
  constructor(readonly detail: ImportMessage) {
    super(detail.code);
  }
}

/** The most an STL file may hold (PRD-0005 S1); each instance may set its own. */
export type StlLimits = { maxBytes: number; maxTriangles: number };

export const DEFAULT_STL_LIMITS: StlLimits = { maxBytes: 50_000_000, maxTriangles: 2_000_000 };

/**
 * A triangle mesh read from an STL file. STL files have no units: their
 * coordinates are taken as millimetres.
 */
export type StlMesh = {
  /** Each triangle's three vertices, `[x, y, z]` each: 9 values per triangle. */
  positions: Float32Array;
  triangles: number;
  bounds: Box3;
};

/** Workers, browsers and Node all have `TextDecoder`; the package's lib types don't include it. */
const Decoder = (
  globalThis as unknown as { TextDecoder: new () => { decode(bytes: Uint8Array): string } }
).TextDecoder;

/** A binary STL's header and triangle count, then 50 bytes per triangle. */
const HEADER_BYTES = 84;
const TRIANGLE_BYTES = 50;

/**
 * Reads a binary or ASCII STL file (PRD-0005 S1). Refuses files larger than
 * `limits` before reading their triangles, and malformed ones, with a
 * `StlImportError`. Facet normals are ignored: they are often wrong, and the
 * mesh is only ever seen from above.
 */
export function parseStl(bytes: Uint8Array, limits: StlLimits = DEFAULT_STL_LIMITS): StlMesh {
  if (bytes.length > limits.maxBytes) {
    throw new StlImportError({ code: "stl.tooLarge", values: { mb: limits.maxBytes / 1_000_000 } });
  }
  if (bytes.length === 0) throw new StlImportError({ code: "stl.empty" });
  // ASCII files start with `solid`, but so do some binary ones: a binary
  // file's size matches the triangle count in its header.
  if (bytes.length >= HEADER_BYTES) {
    const count = new DataView(bytes.buffer, bytes.byteOffset + 80, 4).getUint32(0, true);
    if (bytes.length === HEADER_BYTES + count * TRIANGLE_BYTES) {
      return parseBinary(bytes, count, limits);
    }
  }
  if (startsWithSolid(bytes)) return parseAscii(bytes, limits);
  throw new StlImportError({ code: "stl.sizeMismatch" });
}

function startsWithSolid(bytes: Uint8Array): boolean {
  let i = 0;
  while (i < bytes.length && /\s/.test(String.fromCharCode(bytes[i] as number))) i++;
  return new Decoder().decode(bytes.subarray(i, i + 5)).toLowerCase() === "solid";
}

function checkTriangleCount(count: number, limits: StlLimits) {
  if (count > limits.maxTriangles) {
    throw new StlImportError({
      code: "stl.tooManyTriangles",
      values: { max: limits.maxTriangles },
    });
  }
}

function noTriangles(): never {
  throw new StlImportError({ code: "stl.noTriangles" });
}

function badCoordinate(): never {
  throw new StlImportError({ code: "stl.vertexNaN" });
}

function parseBinary(bytes: Uint8Array, count: number, limits: StlLimits): StlMesh {
  checkTriangleCount(count, limits);
  if (count === 0) noTriangles();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const positions = new Float32Array(count * 9);
  for (let t = 0; t < count; t++) {
    // Each triangle: a normal, three vertices, then two bytes of attributes.
    const at = HEADER_BYTES + t * TRIANGLE_BYTES + 12;
    for (let i = 0; i < 9; i++) {
      const value = view.getFloat32(at + i * 4, true);
      if (!Number.isFinite(value)) badCoordinate();
      positions[t * 9 + i] = value;
    }
  }
  return { positions, triangles: count, bounds: positionsBounds(positions) };
}

/**
 * An ASCII STL, line by line: `solid`, then per triangle `facet normal`,
 * `outer loop`, three `vertex x y z`, `endloop` and `endfacet`, then
 * `endsolid`. Several solids in one file are read as one mesh.
 */
function parseAscii(bytes: Uint8Array, limits: StlLimits): StlMesh {
  const text = new Decoder().decode(bytes);
  let positions = new Float32Array(9 * 1024);
  let triangles = 0;
  /** Vertices read in the open facet, or `-1` outside one. */
  let vertices = -1;
  let line = 0;

  const fail = (code: ImportMessageCode, values: Record<string, string> = {}): never => {
    throw new StlImportError({ code, values: { ...values, line } });
  };

  let start = 0;
  while (start <= text.length) {
    let end = text.indexOf("\n", start);
    if (end === -1) end = text.length;
    line++;
    const words = text.slice(start, end).trim().split(/\s+/);
    start = end + 1;
    const keyword = words[0]?.toLowerCase() ?? "";

    if (keyword === "facet") {
      if (vertices !== -1) fail("stl.facetInFacet");
      checkTriangleCount(triangles + 1, limits);
      vertices = 0;
    } else if (keyword === "vertex") {
      if (vertices === -1) fail("stl.vertexOutside");
      if (vertices === 3) fail("stl.tooManyVertices");
      if (words.length !== 4) fail("stl.vertexCoordinates");
      if (positions.length < (triangles + 1) * 9) {
        const grown = new Float32Array(positions.length * 2);
        grown.set(positions);
        positions = grown;
      }
      for (let i = 0; i < 3; i++) {
        const value = Number(words[i + 1]);
        if (!Number.isFinite(value)) badCoordinate();
        positions[triangles * 9 + vertices * 3 + i] = value;
      }
      vertices++;
    } else if (keyword === "endfacet") {
      if (vertices !== 3) fail("stl.facetVertices");
      triangles++;
      vertices = -1;
    } else if (!["", "solid", "endsolid", "outer", "endloop"].includes(keyword)) {
      fail("stl.notStl", { word: words[0] ?? "" });
    }
  }
  if (vertices !== -1) fail("stl.unfinished");
  if (triangles === 0) noTriangles();
  const trimmed = positions.slice(0, triangles * 9);
  return { positions: trimmed, triangles, bounds: positionsBounds(trimmed) };
}

/** The box around every vertex of a non-empty mesh. */
function positionsBounds(positions: Float32Array): Box3 {
  const min: Box3["min"] = [Infinity, Infinity, Infinity];
  const max: Box3["max"] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let axis = 0; axis < 3; axis++) {
      const value = positions[i + axis] as number;
      if (value < (min[axis] as number)) min[axis] = value;
      if (value > (max[axis] as number)) max[axis] = value;
    }
  }
  return { min, max };
}
