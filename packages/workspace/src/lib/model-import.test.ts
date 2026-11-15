import { DEFAULT_STL_LIMITS } from "@furrow/cam-core";
import { createProjectDocument } from "@furrow/document";
import { fullDocument, model } from "@furrow/document/fixtures";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDocumentStore, type DocumentStore } from "../stores/document-store";
import { addImportedShapes } from "../stores/geometry-actions";
import { addModel } from "../stores/model-actions";
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

/** Has `race` happen while the file uploads, which uploads it unless the project had it. */
function uploadWhile(race: () => void, uploaded = true) {
  meshes.put.mockImplementation(async () => {
    race();
    return { uploaded };
  });
}

const otherMesh = { ...model, sha256: "f".repeat(64), fileName: "other.stl" };

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

  it("adds the model beside a drawing imported meanwhile", async () => {
    uploadWhile(() => addImportedShapes(document, "importSvg", fullDocument().geometry));
    await importFile();
    expect(meshes.discard).not.toHaveBeenCalled();
    expect(document.getState().document.models).toMatchObject([{ sha256: model.sha256 }]);
    expect(document.getState().document.drawings).toHaveLength(1);
    expect(workspace.getState().modelImport).toBeNull();
  });

  it("adds a model beside the project's other models (#596)", async () => {
    addModel(document, otherMesh);
    await importFile();
    expect(document.getState().document.models).toMatchObject([
      { sha256: otherMesh.sha256 },
      { sha256: model.sha256 },
    ]);
    expect(workspace.getState().modelImport).toBeNull();
    expect(workspace.getState().selectedModelId).toBe(document.getState().document.models[1]?.id);
  });

  it("adds the same file twice as two models", async () => {
    await importFile();
    await importFile();
    const models = document.getState().document.models;
    expect(models.map(({ sha256 }) => sha256)).toEqual([model.sha256, model.sha256]);
    expect(models[0]?.id).not.toBe(models[1]?.id);
  });
});
