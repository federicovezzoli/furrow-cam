import { parseStl } from "@furrow/cam-core";
import type { ProjectDocument } from "@furrow/document";
import { exportGcode, type GcodeExport } from "@furrow/post";

/** The project, with the STL files of the models its 3D operations machine, by hash. */
export type GcodeRequest = {
  document: ProjectDocument;
  name: string;
  meshes: Record<string, ArrayBuffer>;
};
export type GcodeResponse = GcodeExport | { error: string };

/** The worker's global scope; the app's TypeScript lib describes a window instead. */
const scope = self as unknown as {
  onmessage: (event: MessageEvent<GcodeRequest>) => void;
  postMessage: (response: GcodeResponse) => void;
};

/** A stored mesh was checked when it was imported; limits lowered since don't refuse it. */
const NO_LIMITS = { maxBytes: Infinity, maxTriangles: Infinity };

// Computes every toolpath and posts the program off the main thread (ADR-0004).
scope.onmessage = ({ data }) => {
  try {
    const meshes = new Map(
      Object.entries(data.meshes).map(([sha256, bytes]) => [
        sha256,
        parseStl(new Uint8Array(bytes), NO_LIMITS).positions,
      ]),
    );
    scope.postMessage(
      exportGcode(data.document, data.name, { mesh: (sha256) => meshes.get(sha256) }),
    );
  } catch (error) {
    scope.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
};
