/// <reference path="../occt-import-js.d.ts" />
import { StlImportError, type StlLimits } from "@furrow/cam-core";
import { MessageError } from "@furrow/document";
import type { Occt } from "occt-import-js";

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

/**
 * The licences of occt-import-js and OpenCascade (LGPL-2.1), shipped beside
 * the WebAssembly as the LGPL asks (ADR-0072).
 */
export const OCCT_LICENCES = [
  new URL("occt-import-js/dist/license.occt.txt", import.meta.url),
  new URL("occt-import-js/dist/license.occt-import-js.txt", import.meta.url),
];

/** A binary STL's header and triangle count, then 50 bytes per triangle. */
const HEADER_BYTES = 84;
const TRIANGLE_BYTES = 50;

/** Whether `bytes` are a STEP file: every one starts with this, after any blanks. */
export function isStepFile(bytes: Uint8Array): boolean {
  const head = new TextDecoder().decode(bytes.subarray(0, 64)).trimStart();
  return head.startsWith("ISO-10303-21");
}

let occt: Promise<Occt> | undefined;

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
  if (!occt) {
    occt = Promise.all([import("occt-import-js"), wasm()]).then(([module, wasmBinary]) =>
      module.default({ wasmBinary }),
    );
    // A failed load is tried again with the next file.
    occt.catch(() => {
      occt = undefined;
    });
  }
  const result = (await occt).ReadStepFile(bytes, TESSELLATION);
  if (!result.success) throw new MessageError({ code: "workspace.stepUnreadable" });
  const meshes = result.meshes ?? [];
  const triangles = meshes.reduce((sum, mesh) => sum + mesh.index.array.length / 3, 0);
  if (triangles === 0) throw new MessageError({ code: "workspace.stepNoSolids" });
  // The STL is stored, so it must also fit the file size limit.
  const max = Math.min(
    limits.maxTriangles,
    Math.floor((limits.maxBytes - HEADER_BYTES) / TRIANGLE_BYTES),
  );
  if (triangles > max) {
    throw new StlImportError({ code: "stl.tooManyTriangles", values: { max } });
  }

  const stl = new Uint8Array(HEADER_BYTES + triangles * TRIANGLE_BYTES);
  const view = new DataView(stl.buffer);
  view.setUint32(80, triangles, true);
  let offset = HEADER_BYTES;
  for (const { attributes, index } of meshes) {
    const positions = attributes.position.array;
    for (let i = 0; i < index.array.length; i += 3) {
      // The normal stays zero (`parseStl` ignores it).
      offset += 12;
      for (const vertex of index.array.slice(i, i + 3)) {
        for (let axis = 0; axis < 3; axis++) {
          view.setFloat32(offset, positions[vertex * 3 + axis] as number, true);
          offset += 4;
        }
      }
      // The attribute byte count, zero.
      offset += 2;
    }
  }
  return stl;
}
