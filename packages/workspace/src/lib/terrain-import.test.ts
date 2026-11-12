import { DEFAULT_STL_LIMITS, type LonLat, modelRect } from "@furrow/cam-core";
import { createProjectDocument, type Model } from "@furrow/document";
import { model } from "@furrow/document/fixtures";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDocumentStore, type DocumentStore } from "../stores/document-store";
import { createWorkspaceStore, type WorkspaceStore } from "../stores/workspace-store";
import type { GeneratedTerrain } from "./mesh-worker-protocol";
import { importGeneratedModel, MeshImportError } from "./model-import";
import { generateTerrain } from "./terrain-import";

const terrain: GeneratedTerrain = {
  sha256: model.sha256,
  triangles: model.triangles,
  bounds: { min: [0, 0, 0], max: [200, 150, 30] },
  stl: new ArrayBuffer(84),
  size: [200, 150, 30],
  heights: [400, 2400],
  cellMetres: 6,
  // The drawn area, a little past the mesh's cells, and one point repeated.
  outline: [
    [-1, -1],
    [201, -1],
    [201, -1],
    [201, 151],
    [-1, 151],
  ],
};

/** The mesh worker: reports one tile, then answers with `terrain`, unless stopped. */
let worker: { terminated: boolean };
class MeshWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  terminated = false;
  constructor() {
    worker = this;
  }
  postMessage({ id }: { id: number }) {
    const send = (data: object) =>
      setTimeout(() => !this.terminated && this.onmessage?.({ data } as MessageEvent));
    send({ kind: "terrainProgress", id, done: 1, total: 1 });
    send({ kind: "terrain", id, ...terrain });
  }
  terminate() {
    this.terminated = true;
  }
}
vi.stubGlobal("Worker", MeshWorker);

const ring: LonLat[] = [
  [9.3, 45.9],
  [9.4, 45.9],
  [9.4, 46],
];
const settings = { longestSide: 200, exaggeration: 1.5, base: 3 };
const meshes = { put: vi.fn(), get: vi.fn(), discard: vi.fn() };
let document: DocumentStore;
let workspace: WorkspaceStore;

beforeEach(() => {
  vi.resetAllMocks();
  meshes.put.mockResolvedValue({ uploaded: true });
  document = createDocumentStore(createProjectDocument());
  workspace = createWorkspaceStore();
});

describe("generateTerrain", () => {
  it("reports progress and resolves with the terrain", async () => {
    const onProgress = vi.fn();
    const made = await generateTerrain(ring, settings, DEFAULT_STL_LIMITS, { onProgress });
    expect(made).toEqual(terrain);
    expect(onProgress).toHaveBeenCalledWith(1, 1);
    expect(worker.terminated).toBe(true);
  });

  it("stops the worker when cancelled", async () => {
    const abort = new AbortController();
    const made = generateTerrain(ring, settings, DEFAULT_STL_LIMITS, { signal: abort.signal });
    abort.abort();
    await expect(made).rejects.toEqual(new MeshImportError({ code: "workspace.cancelled" }));
    expect(worker.terminated).toBe(true);
  });
});

describe("importGeneratedModel", () => {
  it("stores the mesh and adds it at its size, centred, named after the place", async () => {
    expect(
      await importGeneratedModel(terrain, "Grignetta", { meshes, document, workspace }, "terrain"),
    ).toBeNull();
    expect(meshes.put).toHaveBeenCalledWith(terrain.sha256, expect.any(Blob));
    const [added] = document.getState().document.models;
    expect(added).toMatchObject({ fileName: "Grignetta.stl", placement: { scale: 1 } });
    expect(workspace.getState().selectedModelId).toBe(added?.id);
  });

  it("refuses a project that has its model already", async () => {
    await importGeneratedModel(terrain, "Terrain", { meshes, document, workspace }, "terrain");
    expect(
      await importGeneratedModel(terrain, "Terrain", { meshes, document, workspace }, "terrain"),
    ).toEqual({
      code: "workspace.oneModel",
    });
    expect(meshes.put).toHaveBeenCalledTimes(1);
  });
});

describe("importGeneratedModel's undo step", () => {
  it("waits for a drag in progress, so cancelling the drag keeps the model", async () => {
    document.getState().beginTransaction();
    const importing = importGeneratedModel(
      terrain,
      "Lake",
      { meshes, document, workspace },
      "terrain",
    );
    await new Promise((resolve) => setTimeout(resolve));
    expect(document.getState().document.models).toEqual([]);
    document.getState().cancelTransaction();
    expect(await importing).toBeNull();
    expect(document.getState().document.models).toHaveLength(1);
    // Its own step: one undo takes it away.
    document.getState().undo();
    expect(document.getState().document.models).toEqual([]);
  });
});
