import type { StlLimits } from "@furrow/cam-core";
import { type Message, MessageError } from "@furrow/document";
import type { Translatable } from "@furrow/ui/lib/i18n";
import type { DocumentState, DocumentStore } from "../stores/document-store";
import { hasImportedFile, ONE_FILE } from "../stores/geometry-actions";
import { addModel } from "../stores/model-actions";
import type { WorkspaceStore } from "../stores/workspace-store";
import type { MeshResponse, MeshSummary } from "./mesh-worker-protocol";
import { track } from "./telemetry";
import type { WorkspaceHost } from "./workspace-host";

/** Why an STL file can't be imported, for the user (ADR-0054). */
export class MeshImportError extends MessageError {}

const UNREADABLE: Message = { code: "workspace.unreadableFile" };

/**
 * Reads and checks an STL file in a Web Worker of its own (ADR-0004), which
 * then goes away with the mesh. Throws a `MeshImportError` if the file can't
 * be imported.
 */
export function parseMesh(bytes: ArrayBuffer, limits: StlLimits): Promise<MeshSummary> {
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
        reject(new MeshImportError(data.kind === "failed" ? data.error : UNREADABLE));
      }
    };
    worker.onerror = (event) => {
      event.preventDefault();
      worker.terminate();
      reject(new MeshImportError(UNREADABLE));
    };
    worker.postMessage({ kind: "parse", id: 0, bytes, limits }, [bytes]);
  });
}

/**
 * Whether the document or its undo and redo steps refer to mesh `sha256`,
 * e.g. the same file imported twice at once and the model since removed.
 * A hash can't occur by chance, so the patches are searched as text.
 */
export function usesMesh({ document, past, future }: DocumentState, sha256: string): boolean {
  return (
    document.models.some((model) => model.sha256 === sha256) ||
    JSON.stringify([past, future]).includes(sha256)
  );
}

/**
 * Imports an STL file into the open project (PRD-0005 S1, ADR-0029): reads
 * and checks it, stores it in the project's `meshes`, then adds it to the
 * document as one undo step and selects it. A project holds one imported
 * file for now, so nothing is stored into one that has a drawing or a model.
 * The workspace's `modelImport` says how it is going.
 */
export async function importModel(
  file: File,
  {
    meshes,
    limits,
    document,
    workspace,
  }: {
    meshes: WorkspaceHost["meshes"];
    limits: StlLimits;
    document: DocumentStore;
    workspace: WorkspaceStore;
  },
) {
  const fileName = file.name;
  const { setModelImport } = workspace.getState();
  const fail = (error: Translatable) => setModelImport({ fileName, error });
  setModelImport({ fileName, error: null });

  if (hasImportedFile(document.getState().document)) {
    fail(ONE_FILE);
    return;
  }
  if (file.size > limits.maxBytes) {
    fail({ code: "stl.tooLarge", values: { mb: limits.maxBytes / 1_000_000 } });
    return;
  }
  let mesh: MeshSummary;
  try {
    mesh = await parseMesh(await file.arrayBuffer(), limits);
  } catch (error) {
    fail(error instanceof MeshImportError ? error.detail : UNREADABLE);
    return;
  }
  const upload = await meshes.put(mesh.sha256, file);
  if (upload.error !== undefined) {
    fail(upload.error);
    return;
  }
  // A drawing may have been imported, or a step redone, while this one uploaded.
  const id = addModel(document, { ...mesh, fileName, size: file.size });
  if (id === null) {
    // Only a mesh this import stored goes, and the server keeps one that something saved uses.
    if (upload.uploaded && !usesMesh(document.getState(), mesh.sha256)) {
      await meshes.discard(mesh.sha256);
    }
    fail(ONE_FILE);
    return;
  }
  workspace.getState().selectModel(id);
  setModelImport(null);
  track({ event: "file_imported", format: "stl" });
}
