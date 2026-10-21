import type { StlLimits } from "@furrow/cam-core";
import { type Message, MessageError } from "@furrow/document";
import type { Translatable } from "@furrow/ui/lib/i18n";
import type { DocumentStore } from "../stores/document-store";
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
 * Imports an STL file into the open project (PRD-0005 S1, ADR-0029): reads
 * and checks it, stores it in the project's `meshes`, then adds it to the
 * document as one undo step and selects it, alongside the project's
 * drawings and models (ADR-0055). The workspace's `modelImport` says how it is going.
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
  const id = addModel(document, { ...mesh, fileName, size: file.size });
  workspace.getState().selectModel(id);
  setModelImport(null);
  track({ event: "file_imported", format: "stl" });
}
