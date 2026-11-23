/// <reference path="../occt-import-js.d.ts" />
import {
  binaryStlTriangles,
  StlImportError,
  type StlLimits,
  writeBinaryStl,
} from "@furrow/cam-core";
import { MessageError } from "@furrow/document";
import type { Occt, OcctMesh, OcctResult } from "occt-import-js";

/**
 * How closely the triangles follow curved faces (ADR-0072): at most 0.05 mm
 * from the surface, finer than a router cuts, and about half a degree turn
 * between neighbours.
 */
const TESSELLATION = {
  linearUnit: "millimeter",
  linearDeflectionType: "absolute_value",
  linearDeflection: 0.05,
  angularDeflection: 0.5,
} as const;

/** Whether `bytes` are a STEP file: every one starts with this, after any blanks. */
export function isStepFile(bytes: Uint8Array): boolean {
  const head = new TextDecoder().decode(bytes.subarray(0, 64)).trimStart();
  return head.startsWith("ISO-10303-21");
}

let occt: Promise<Occt> | undefined;

/** OpenCascade, loaded once; a failed load is tried again with the next file. */
function loadOcct(wasm: () => Promise<ArrayBuffer | Uint8Array>): Promise<Occt> {
  if (!occt) {
    occt = Promise.all([import("occt-import-js"), wasm()])
      .then(([module, wasmBinary]) => module.default({ wasmBinary }))
      .catch((error) => {
        occt = undefined;
        if (error instanceof MessageError) throw error;
        // The chunk or the WebAssembly couldn't be fetched or compiled, e.g. offline.
        throw new MessageError({ code: "workspace.stepImportUnavailable" });
      });
  }
  return occt;
}

/**
 * How many triangles each face of `mesh`'s solid was meshed into, in order,
 * or `null` if its faces don't share out its triangles one after another.
 */
export function faceSizes(mesh: Pick<OcctMesh, "index" | "brep_faces">): number[] | null {
  const sizes: number[] = [];
  let next = 0;
  for (const { first, last } of mesh.brep_faces ?? []) {
    if (first !== next || last < first - 1) return null;
    // A face meshed into no triangles has none to keep.
    if (last >= first) sizes.push(last - first + 1);
    next = last + 1;
  }
  return next === mesh.index.array.length / 3 ? sizes : null;
}

/**
 * Turns a STEP file into a binary STL in millimetres (ADR-0072), which is
 * then imported and stored like any STL, with `faces`, how many of its
 * triangles each face of the solid was meshed into (ADR-0093), unless
 * OpenCascade doesn't say. `wasm` reads OpenCascade's WebAssembly, loaded
 * only for the first STEP file. Refuses a file OpenCascade can't read or with
 * no solids, and a mesh that the STL limits wouldn't take, with a
 * `MessageError`.
 */
export async function stepToStl(
  bytes: Uint8Array,
  limits: StlLimits,
  wasm: () => Promise<ArrayBuffer | Uint8Array>,
): Promise<{ stl: Uint8Array<ArrayBuffer>; faces?: number[] }> {
  const kernel = await loadOcct(wasm);
  let result: OcctResult;
  try {
    result = kernel.ReadStepFile(bytes, TESSELLATION);
  } catch {
    // An aborted instance (out of memory, a C++ exception) can't be used again.
    occt = undefined;
    throw new MessageError({ code: "workspace.stepUnreadable" });
  }
  if (!result.success) throw new MessageError({ code: "workspace.stepUnreadable" });
  const solids = result.meshes ?? [];
  const meshes = solids.map((mesh) => ({
    positions: mesh.attributes.position.array,
    indices: mesh.index.array,
  }));
  const triangles = meshes.reduce((sum, mesh) => sum + mesh.indices.length / 3, 0);
  if (triangles === 0) throw new MessageError({ code: "workspace.stepNoSolids" });
  // The STL is stored, so it must also fit the file size limit.
  const max = Math.min(limits.maxTriangles, binaryStlTriangles(limits.maxBytes));
  if (triangles > max) {
    throw new StlImportError({ code: "stl.tooManyTriangles", values: { max } });
  }
  const sizes = solids.map(faceSizes);
  const faces = sizes.every((size) => size !== null) ? sizes.flat() : undefined;
  return { stl: writeBinaryStl(meshes), ...(faces && { faces }) };
}
