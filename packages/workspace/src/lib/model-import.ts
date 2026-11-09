import type { StlLimits } from "@furrow/cam-core";
import { type Message, MessageError } from "@furrow/document";
import type { Translatable } from "@furrow/ui/lib/i18n";
import type { DocumentState, DocumentStore } from "../stores/document-store";
import { canImportModel, ONE_MODEL } from "../stores/geometry-actions";
import { addModel } from "../stores/model-actions";
import type { WorkspaceStore } from "../stores/workspace-store";
import type { MeshRequest, MeshResponse, MeshSummary } from "./mesh-worker-protocol";
import { track } from "./telemetry";
import type { WorkspaceHost } from "./workspace-host";

/** Why an STL or STEP file can't be imported, for the user (ADR-0054). */
export class MeshImportError extends MessageError {}

const UNREADABLE: Message = { code: "workspace.unreadableFile" };
const CANCELLED: Message = { code: "workspace.cancelled" };

/** A mesh worker's answer, past its progress reports and failures. */
type MeshAnswer = Exclude<MeshResponse, { kind: "failed" | "terrainProgress" }>;

/**
 * Sends `request` to a mesh worker of its own (ADR-0004), which goes away
 * with its answer. `terrainProgress` reports go to `onProgress`. Rejects with
 * a `MeshImportError`: the worker's own error, `fallback` if it crashes, or
 * `workspace.cancelled` once `signal` aborts.
 */
export function runMeshWorker(
  request: MeshRequest,
  transfer: Transferable[],
  fallback: Message,
  {
    onProgress,
    signal,
  }: { onProgress?: (done: number, total: number) => void; signal?: AbortSignal } = {},
): Promise<MeshAnswer> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new MeshImportError(CANCELLED));
    const worker = new Worker(new URL("../workers/mesh.worker.ts", import.meta.url), {
      type: "module",
    });
    const finish = () => {
      worker.terminate();
      signal?.removeEventListener("abort", abort);
    };
    const fail = (error: Message) => {
      finish();
      reject(new MeshImportError(error));
    };
    const abort = () => fail(CANCELLED);
    signal?.addEventListener("abort", abort, { once: true });
    worker.onmessage = ({ data }: MessageEvent<MeshResponse>) => {
      if (data.kind === "terrainProgress") onProgress?.(data.done, data.total);
      else if (data.kind === "failed") fail(data.error);
      else {
        finish();
        resolve(data);
      }
    };
    worker.onerror = (event) => {
      event.preventDefault();
      fail(fallback);
    };
    worker.postMessage(request, transfer);
  });
}

/**
 * Reads and checks an STL file in a mesh worker of its own. A STEP file
 * comes back as the STL made from it, `stl` (ADR-0072). Throws a
 * `MeshImportError` if the file can't be imported.
 */
export async function parseMesh(
  bytes: ArrayBuffer,
  limits: StlLimits,
): Promise<MeshSummary & { stl?: ArrayBuffer }> {
  const data = await runMeshWorker({ kind: "parse", id: 0, bytes, limits }, [bytes], UNREADABLE);
  if (data.kind !== "parsed") throw new MeshImportError(UNREADABLE);
  const { sha256, triangles, bounds, stl } = data;
  return { sha256, triangles, bounds, ...(stl && { stl }) };
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
  const error = await storeModel(mesh, stored, fileName, { meshes, document, workspace });
  if (error) {
    fail(error);
    return;
  }
  setModelImport(null);
  track({ event: "file_imported", format: mesh.stl ? "step" : "stl" });
}

/** Resolves once no gesture holds the document's history open. */
function gestureDone(document: DocumentStore): Promise<void> {
  if (!document.getState().inTransaction) return Promise.resolve();
  return new Promise((resolve) => {
    const stop = document.subscribe(({ inTransaction }) => {
      if (inTransaction) return;
      stop();
      resolve();
    });
  });
}

/**
 * Stores the checked mesh `stored` in the project's `meshes` and adds it to
 * the document as one undo step, selected; `fit: false` keeps its size
 * (`addModel`). Returns why it couldn't, or `null`.
 */
export async function storeModel(
  mesh: MeshSummary,
  stored: Blob,
  fileName: string,
  {
    meshes,
    document,
    workspace,
    fit,
  }: {
    meshes: WorkspaceHost["meshes"];
    document: DocumentStore;
    workspace: WorkspaceStore;
    fit?: boolean;
  },
): Promise<Translatable | null> {
  const upload = await meshes.put(mesh.sha256, stored);
  if (upload.error !== undefined) return upload.error;
  // Another model may have been imported, or a step redone, while this one uploaded.
  const { sha256, triangles, bounds } = mesh;
  // An undo step of its own: a gesture still open (a drag) is let finish first, so cancelling
  // it can't take the model away after it was stored and selected.
  await gestureDone(document);
  const id = addModel(
    document,
    { sha256, triangles, bounds, fileName, size: stored.size },
    { fit },
  );
  if (id === null) {
    // Only a mesh this import stored goes, and the server keeps one that something saved uses.
    if (upload.uploaded && !usesMesh(document.getState(), mesh.sha256)) {
      await meshes.discard(mesh.sha256);
    }
    return ONE_MODEL;
  }
  workspace.getState().selectModel(id);
  return null;
}
