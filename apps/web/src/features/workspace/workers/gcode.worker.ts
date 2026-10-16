import { parseStl } from "@furrow/cam-core";
import type { ProjectDocument } from "@furrow/document";
import { exportGcode, type GcodeExport } from "@furrow/post";
import { sha256Hex } from "@/features/workspace/lib/mesh-worker-protocol";

/** The project, with the STL files of the models its 3D operations machine, by hash. */
export type GcodeRequest = {
  document: ProjectDocument;
  name: string;
  meshes: Record<string, ArrayBuffer>;
};
export type GcodeResponse = GcodeExport | { error: string };

/** The worker's global scope; the app's TypeScript lib describes a window instead. */
const scope = self as unknown as {
  onmessage: (event: MessageEvent<GcodeRequest>) => void | Promise<void>;
  postMessage: (response: GcodeResponse) => void;
};

/** A stored mesh was checked when it was imported; limits lowered since don't refuse it. */
const NO_LIMITS = { maxBytes: Infinity, maxTriangles: Infinity };

/**
 * The triangles of each STL file, by hash. Each file is checked against its
 * hash first (ADR-0029): a stale or corrupted cache entry mustn't be machined.
 */
async function readMeshes(files: Record<string, ArrayBuffer>) {
  const meshes = new Map<string, Float32Array>();
  for (const [sha256, bytes] of Object.entries(files)) {
    if ((await sha256Hex(bytes)) !== sha256) {
      throw new Error("The stored model doesn't match its file.");
    }
    meshes.set(sha256, parseStl(new Uint8Array(bytes), NO_LIMITS).positions);
  }
  return meshes;
}

// Computes every toolpath and posts the program off the main thread (ADR-0004).
scope.onmessage = async ({ data }) => {
  try {
    const meshes = await readMeshes(data.meshes);
    scope.postMessage(
      exportGcode(data.document, data.name, { mesh: (sha256) => meshes.get(sha256) }),
    );
  } catch (error) {
    scope.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
};
