import { DEFAULT_STL_LIMITS } from "@furrow/cam-core";
import { createProjectDocument } from "@furrow/document";
import { fullDocument, model } from "@furrow/document/fixtures";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDocumentStore, type DocumentStore } from "../stores/document-store";
import { addImportedShapes, DRAWINGS_OR_MODEL } from "../stores/geometry-actions";
import { addModel, removeModel } from "../stores/model-actions";
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

  it("discards the upload when a drawing was imported meanwhile", async () => {
    uploadWhile(() => addImportedShapes(document, "importSvg", fullDocument().geometry));
    await importFile();
    expect(meshes.discard).toHaveBeenCalledWith(model.sha256);
    expect(document.getState().document.models).toEqual([]);
    expect(workspace.getState().modelImport).toEqual({
      fileName: "relief.stl",
      error: DRAWINGS_OR_MODEL,
    });
  });

  it("discards the upload when another model was added meanwhile", async () => {
    uploadWhile(() => addModel(document, otherMesh));
    await importFile();
    expect(meshes.discard).toHaveBeenCalledWith(model.sha256);
  });

  it("keeps a mesh the project already had", async () => {
    uploadWhile(() => addModel(document, otherMesh), false);
    await importFile();
    expect(meshes.discard).not.toHaveBeenCalled();
  });

  it("keeps a mesh the document uses: the same file imported twice at once", async () => {
    const { sha256, triangles, bounds, size } = model;
    uploadWhile(() =>
      addModel(document, { sha256, triangles, bounds, size, fileName: "copy.stl" }),
    );
    await importFile();
    expect(meshes.discard).not.toHaveBeenCalled();
    expect(workspace.getState().modelImport?.error).toBe(DRAWINGS_OR_MODEL);
  });

  it("keeps a mesh the undo history refers to: the same file imported and removed meanwhile", async () => {
    const { sha256, triangles, bounds, size } = model;
    uploadWhile(() => {
      const id = addModel(document, { sha256, triangles, bounds, size, fileName: "copy.stl" });
      if (id) removeModel(document, id);
      addImportedShapes(document, "importSvg", fullDocument().geometry);
    });
    await importFile();
    expect(meshes.discard).not.toHaveBeenCalled();
    expect(document.getState().document.models).toEqual([]);
  });

  it("uploads nothing into a project that has a file", async () => {
    addModel(document, otherMesh);
    await importFile();
    expect(meshes.put).not.toHaveBeenCalled();
    expect(workspace.getState().modelImport?.error).toBe(DRAWINGS_OR_MODEL);
  });
});
