import type { StlLimits } from "@furrow/cam-core";
import { type Message, MessageError } from "@furrow/document";
import type { Translatable } from "@furrow/ui/lib/i18n";
import type { DocumentState, DocumentStore } from "../stores/document-store";
import { canImportModel, ONE_MODEL } from "../stores/geometry-actions";
import { addModel } from "../stores/model-actions";
import type { WorkspaceStore } from "../stores/workspace-store";
import type { MeshResponse, MeshSummary } from "./mesh-worker-protocol";
import { track } from "./telemetry";
import type { WorkspaceHost } from "./workspace-host";

/** Why an STL or STEP file can't be imported, for the user (ADR-0054). */
export class MeshImportError extends MessageError {}

const UNREADABLE: Message = { code: "workspace.unreadableFile" };

/**
 * Reads and checks an STL file in a Web Worker of its own (ADR-0004), which
 * then goes away with the mesh. A STEP file comes back as the STL made from
 * it, `stl` (ADR-0072). Throws a `MeshImportError` if the file can't be
 * imported.
 */
export function parseMesh(
  bytes: ArrayBuffer,
  limits: StlLimits,
): Promise<MeshSummary & { stl?: ArrayBuffer }> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("../workers/mesh.worker.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = ({ data }: MessageEvent<MeshResponse>) => {
      worker.terminate();
      if (data.kind === "parsed") {
        const { sha256, triangles, bounds, stl } = data;
        resolve({ sha256, triangles, bounds, ...(stl && { stl }) });
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
 * Imports an STL or STEP file into the open project (PRD-0005 S1, ADR-0029,
 * ADR-0072): reads and checks it, stores it (a STEP file as the STL made
 * from it) in the project's `meshes`, then adds it to the
 * document as one undo step and selects it. A project holds at most one
 * model (ADR-0078), so nothing is stored into one that has a model.
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

  if (!canImportModel(document.getState().document)) {
    fail(ONE_MODEL);
    return;
  }
  if (file.size > limits.maxBytes) {
    fail({ code: "stl.tooLarge", values: { mb: limits.maxBytes / 1_000_000 } });
    return;
  }
  let mesh: MeshSummary & { stl?: ArrayBuffer };
  try {
    mesh = await parseMesh(await file.arrayBuffer(), limits);
  } catch (error) {
    fail(error instanceof MeshImportError ? error.detail : UNREADABLE);
    return;
  }
  const stored = mesh.stl ? new Blob([mesh.stl]) : file;
  const upload = await meshes.put(mesh.sha256, stored);
  if (upload.error !== undefined) {
    fail(upload.error);
    return;
  }
  // A drawing may have been imported, or a step redone, while this one uploaded.
  const { sha256, triangles, bounds } = mesh;
  const id = addModel(document, { sha256, triangles, bounds, fileName, size: stored.size });
  if (id === null) {
    // Only a mesh this import stored goes, and the server keeps one that something saved uses.
    if (upload.uploaded && !usesMesh(document.getState(), mesh.sha256)) {
      await meshes.discard(mesh.sha256);
    }
    fail(ONE_MODEL);
    return;
  }
  workspace.getState().selectModel(id);
  setModelImport(null);
  track({ event: "file_imported", format: mesh.stl ? "step" : "stl" });
}
