/// <reference path="../occt-import-js.d.ts" />
import {
  binaryStlTriangles,
  StlImportError,
  type StlLimits,
  writeBinaryStl,
} from "@furrow/cam-core";
import { MessageError } from "@furrow/document";
import type { Occt, OcctResult } from "occt-import-js";

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
 * Turns a STEP file into a binary STL in millimetres (ADR-0072), which is
 * then imported and stored like any STL. `wasm` reads OpenCascade's
 * WebAssembly, loaded only for the first STEP file. Refuses a file OpenCascade
 * can't read or with no solids, and a mesh that the STL limits wouldn't take,
 * with a `MessageError`.
 */
export async function stepToStl(
  bytes: Uint8Array,
  limits: StlLimits,
  wasm: () => Promise<ArrayBuffer | Uint8Array>,
): Promise<Uint8Array<ArrayBuffer>> {
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
  const meshes = (result.meshes ?? []).map((mesh) => ({
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
  return writeBinaryStl(meshes);
}
