import type { ModelFlatFaces } from "@furrow/cam-core";
import { fullDocument, model } from "@furrow/document/fixtures";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDocumentStore, type DocumentStore } from "../stores/document-store";
import { moveModel } from "../stores/model-actions";
import { drawingsFromModel } from "./model-drawings";

const worker = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("./model-import", async (original) => ({
  ...(await original<typeof import("./model-import")>()),
  runMeshWorker: worker.run,
}));

const square = {
  start: [0, 0] as [number, number],
  segments: [
    [10, 0],
    [10, 10],
    [0, 10],
  ].map((to) => ({ kind: "line" as const, to: to as [number, number] })),
  closed: true,
};
const FOUND: ModelFlatFaces = { levels: [{ z: -6, paths: [square] }], outline: [square] };
const meshes = { get: async () => new ArrayBuffer(8), put: vi.fn(), discard: vi.fn() };

let store: DocumentStore;
beforeEach(() => {
  store = createDocumentStore({ ...fullDocument(), models: [model] });
  worker.run.mockReset();
});

describe("drawingsFromModel", () => {
  it("adds the levels and the outline as one drawing named after the model", async () => {
    worker.run.mockResolvedValue({ kind: "faces", id: 0, ...FOUND });
    const result = await drawingsFromModel(model.id, "Outline", { meshes, document: store });
    expect(result).toMatchObject({ ok: true, levels: 1 });
    const { drawings, geometry } = store.getState().document;
    const id = result.ok ? result.id : "";
    expect(drawings.find((d) => d.id === id)?.name).toBe(model.fileName);
    expect(geometry.filter((s) => s.drawingId === id).map(({ layer }) => layer)).toEqual([
      "Z -0.2362 in",
      "Outline",
    ]);
  });

  it("adds nothing if the model moved while the worker ran", async () => {
    worker.run.mockImplementation(async () => {
      moveModel(store, model.id, [5, 0]);
      return { kind: "faces", id: 0, ...FOUND };
    });
    const before = store.getState().document.drawings.length;
    expect(await drawingsFromModel(model.id, "Outline", { meshes, document: store })).toEqual({
      ok: false,
      error: { code: "workspace.modelChanged" },
    });
    expect(store.getState().document.drawings).toHaveLength(before);
  });

  it("says so when the model has nothing to draw", async () => {
    worker.run.mockResolvedValue({ kind: "faces", id: 0, levels: [], outline: [] });
    expect(await drawingsFromModel(model.id, "Outline", { meshes, document: store })).toEqual({
      ok: false,
      error: { code: "workspace.noModelFaces" },
    });
  });
});
