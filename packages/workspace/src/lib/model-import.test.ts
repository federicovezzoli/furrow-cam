import { DEFAULT_STL_LIMITS } from "@furrow/cam-core";
import { createProjectDocument } from "@furrow/document";
import { fullDocument, model } from "@furrow/document/fixtures";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDocumentStore, type DocumentStore } from "../stores/document-store";
import { createWorkspaceStore, type WorkspaceStore } from "../stores/workspace-store";
import { importModel } from "./model-import";

/** The workspace host's meshes. */
const meshes = { put: vi.fn(), get: vi.fn(), discard: vi.fn() };

/** The mesh worker: reads every file as the fixture model. */
class MeshWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  postMessage({ id }: { id: number }) {
    const { sha256, triangles, bounds } = model;
    queueMicrotask(() =>
      this.onmessage?.({ data: { kind: "parsed", id, sha256, triangles, bounds } } as MessageEvent),
    );
  }
  terminate() {}
}
vi.stubGlobal("Worker", MeshWorker);

let document: DocumentStore;
let workspace: WorkspaceStore;
const file = new File(["solid relief"], "relief.stl");

function importFile() {
  return importModel(file, { meshes, limits: DEFAULT_STL_LIMITS, document, workspace });
}

beforeEach(() => {
  vi.resetAllMocks();
  document = createDocumentStore(createProjectDocument());
  workspace = createWorkspaceStore();
  meshes.put.mockResolvedValue({ uploaded: true });
});

describe("importModel", () => {
  it("adds the uploaded mesh as a model", async () => {
    await importFile();
    expect(document.getState().document.models).toMatchObject([{ sha256: model.sha256 }]);
    expect(workspace.getState().modelImport).toBeNull();
    expect(meshes.discard).not.toHaveBeenCalled();
  });

  it("adds a model to a project with drawings and models", async () => {
    document = createDocumentStore({
      ...fullDocument(),
      models: [{ ...model, sha256: "f".repeat(64), fileName: "other.stl" }],
    });
    await importFile();
    expect(document.getState().document.models).toHaveLength(2);
    expect(document.getState().document.geometry).toEqual(fullDocument().geometry);
    expect(workspace.getState().modelImport).toBeNull();
  });
});
