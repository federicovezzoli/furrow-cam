import { DEFAULT_STL_LIMITS } from "@furrow/cam-core";
import { createProjectDocument } from "@furrow/document";
import { fullDocument, model } from "@furrow/document/fixtures";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDocumentStore, type DocumentStore } from "../stores/document-store";
import { addImportedShapes, ONE_FILE } from "../stores/geometry-actions";
import { addModel } from "../stores/model-actions";
import { createWorkspaceStore, type WorkspaceStore } from "../stores/workspace-store";
import { importModel } from "./model-import";

const PROJECT = "00000000-0000-4000-8000-000000000001";

const meshes = vi.hoisted(() => ({ uploadMesh: vi.fn(), discardUpload: vi.fn() }));
vi.mock("@/features/assets/lib/meshes", () => meshes);
vi.mock("./mesh-cache", () => ({ cacheMesh: async () => {} }));

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
  return importModel(file, { projectId: PROJECT, limits: DEFAULT_STL_LIMITS, document, workspace });
}

/** Has `race` happen while the file uploads, which uploads it unless the project had it. */
function uploadWhile(race: () => void, uploaded = true) {
  meshes.uploadMesh.mockImplementation(async () => {
    race();
    return { uploaded };
  });
}

const otherMesh = { ...model, sha256: "f".repeat(64), fileName: "other.stl" };

beforeEach(() => {
  vi.resetAllMocks();
  document = createDocumentStore(createProjectDocument());
  workspace = createWorkspaceStore();
  meshes.uploadMesh.mockResolvedValue({ uploaded: true });
});

describe("importModel", () => {
  it("adds the uploaded mesh as a model", async () => {
    await importFile();
    expect(document.getState().document.models).toMatchObject([{ sha256: model.sha256 }]);
    expect(workspace.getState().modelImport).toBeNull();
    expect(meshes.discardUpload).not.toHaveBeenCalled();
  });

  it("discards the upload when a drawing was imported meanwhile", async () => {
    uploadWhile(() => addImportedShapes(document, "importSvg", fullDocument().geometry));
    await importFile();
    expect(meshes.discardUpload).toHaveBeenCalledWith(PROJECT, model.sha256);
    expect(document.getState().document.models).toEqual([]);
    expect(workspace.getState().modelImport).toEqual({ fileName: "relief.stl", error: ONE_FILE });
  });

  it("discards the upload when another model was added meanwhile", async () => {
    uploadWhile(() => addModel(document, otherMesh));
    await importFile();
    expect(meshes.discardUpload).toHaveBeenCalledWith(PROJECT, model.sha256);
  });

  it("keeps a mesh the project already had", async () => {
    uploadWhile(() => addModel(document, otherMesh), false);
    await importFile();
    expect(meshes.discardUpload).not.toHaveBeenCalled();
  });

  it("keeps a mesh the document uses: the same file imported twice at once", async () => {
    const { sha256, triangles, bounds, size } = model;
    uploadWhile(() =>
      addModel(document, { sha256, triangles, bounds, size, fileName: "copy.stl" }),
    );
    await importFile();
    expect(meshes.discardUpload).not.toHaveBeenCalled();
    expect(workspace.getState().modelImport?.error).toBe(ONE_FILE);
  });

  it("uploads nothing into a project that has a file", async () => {
    addModel(document, otherMesh);
    await importFile();
    expect(meshes.uploadMesh).not.toHaveBeenCalled();
    expect(workspace.getState().modelImport?.error).toBe(ONE_FILE);
  });
});
