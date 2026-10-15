import type { StlLimits } from "@furrow/cam-core";
import { uploadMesh } from "@/features/assets/lib/meshes";
import type { DocumentStore } from "@/features/workspace/stores/document-store";
import { hasImportedFile, ONE_FILE } from "@/features/workspace/stores/geometry-actions";
import { addModel } from "@/features/workspace/stores/model-actions";
import type { WorkspaceStore } from "@/features/workspace/stores/workspace-store";
import { cacheMesh } from "./mesh-cache";
import type { MeshResponse, MeshSummary } from "./mesh-worker-protocol";

/**
 * Reads and checks an STL file in a Web Worker of its own (ADR-0004), which
 * then goes away with the mesh. Throws an `Error` for the user if the file
 * can't be imported.
 */
function parseMesh(bytes: ArrayBuffer, limits: StlLimits): Promise<MeshSummary> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("../workers/mesh.worker.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = ({ data }: MessageEvent<MeshResponse>) => {
      worker.terminate();
      if (data.kind === "parsed") {
        const { sha256, triangles, bounds } = data;
        resolve({ sha256, triangles, bounds });
      } else {
        reject(new Error(data.kind === "failed" ? data.error : "This file couldn't be read."));
      }
    };
    worker.onerror = (event) => {
      event.preventDefault();
      worker.terminate();
      reject(new Error("This file couldn't be read."));
    };
    worker.postMessage({ kind: "parse", id: 0, bytes, limits }, [bytes]);
  });
}

/**
 * Imports an STL file into the open project (PRD-0005 S1, ADR-0029): reads
 * and checks it, uploads it as a project asset, caches it, then adds it to
 * the document as one undo step and selects it. A project holds one
 * imported file for now, so nothing is uploaded into one that has a drawing
 * or a model. The workspace's
 * `modelImport` says how it is going.
 */
export async function importModel(
  file: File,
  {
    projectId,
    limits,
    document,
    workspace,
  }: {
    projectId: string;
    limits: StlLimits;
    document: DocumentStore;
    workspace: WorkspaceStore;
  },
) {
  const fileName = file.name;
  const { setModelImport } = workspace.getState();
  const fail = (error: string) => setModelImport({ fileName, error });
  setModelImport({ fileName, error: null });

  if (hasImportedFile(document.getState().document)) {
    fail(ONE_FILE);
    return;
  }
  if (file.size > limits.maxBytes) {
    fail(`This file is larger than ${limits.maxBytes / 1_000_000} MB, the most allowed.`);
    return;
  }
  let mesh: MeshSummary;
  try {
    mesh = await parseMesh(await file.arrayBuffer(), limits);
  } catch (error) {
    fail(error instanceof Error ? error.message : "This file couldn't be read.");
    return;
  }
  const error = await uploadMesh(projectId, mesh.sha256, file);
  if (error !== undefined) {
    fail(error);
    return;
  }
  await cacheMesh(mesh.sha256, file);
  // A drawing may have been imported, or a step redone, while this one uploaded.
  const id = addModel(document, { ...mesh, fileName, size: file.size });
  if (id === null) {
    fail(ONE_FILE);
    return;
  }
  workspace.getState().selectModel(id);
  setModelImport(null);
}
