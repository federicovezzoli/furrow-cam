import { modelHeightmap, parseStl, StlImportError, type StlMesh } from "@furrow/cam-core";
import { type MeshRequest, type MeshResponse, sha256Hex } from "../lib/mesh-worker-protocol";

/** The worker's global scope; the app's TypeScript lib describes a window instead. */
const scope = self as unknown as {
  onmessage: (event: MessageEvent<MeshRequest>) => void;
  postMessage: (response: MeshResponse, transfer?: Transferable[]) => void;
};

/**
 * Meshes read lately, by hash, least recently used first. A 2-million-triangle
 * mesh takes 72 MB, so only a few are kept; the rest are sent again.
 */
const meshes = new Map<string, StlMesh>();
const KEPT_MESHES = 4;

function keep(sha256: string, mesh: StlMesh) {
  meshes.delete(sha256);
  meshes.set(sha256, mesh);
  for (const oldest of meshes.keys()) {
    if (meshes.size <= KEPT_MESHES) break;
    meshes.delete(oldest);
  }
}

/** A stored mesh was checked when it was imported; limits lowered since don't refuse it. */
const NO_LIMITS = { maxBytes: Infinity, maxTriangles: Infinity };

async function handle(request: MeshRequest): Promise<MeshResponse> {
  const { id } = request;
  if (request.kind === "parse") {
    const mesh = parseStl(new Uint8Array(request.bytes), request.limits);
    const sha256 = await sha256Hex(request.bytes);
    keep(sha256, mesh);
    return { kind: "parsed", id, sha256, triangles: mesh.triangles, bounds: mesh.bounds };
  }

  let mesh = meshes.get(request.sha256);
  if (!mesh) {
    if (!request.bytes) return { kind: "missing", id };
    if ((await sha256Hex(request.bytes)) !== request.sha256) {
      return { kind: "failed", id, error: "The stored model doesn't match its file." };
    }
    mesh = parseStl(new Uint8Array(request.bytes), NO_LIMITS);
  }
  keep(request.sha256, mesh);
  const heightmap = modelHeightmap(mesh.positions, request.bounds, request.rotation);
  return { kind: "preview", id, heightmap };
}

// Requests are answered in the order they arrive, one at a time.
let queue = Promise.resolve();

scope.onmessage = ({ data }) => {
  queue = queue.then(async () => {
    try {
      const response = await handle(data);
      const transfer =
        response.kind === "preview" && response.heightmap
          ? [response.heightmap.heights.buffer]
          : [];
      scope.postMessage(response, transfer);
    } catch (error) {
      if (!(error instanceof StlImportError)) console.error(error);
      const message =
        error instanceof StlImportError ? error.message : "This file couldn't be read.";
      scope.postMessage({ kind: "failed", id: data.id, error: message });
    }
  });
};
