import { modelRect } from "@furrow/cam-core";
import { createProjectDocument, type Model, ProjectDocument } from "@furrow/document";
import { ballEndMill, fullDocument, model } from "@furrow/document/fixtures";
import { describe, expect, it } from "vitest";
import { createDocumentStore } from "./document-store";
import { drawingAnchor, expectClose } from "./drawing-test-utils";
import {
  addModel,
  fitModelToStock,
  modelOffset,
  modelOperations,
  removeModel,
  setModelBorder,
  setModelDepth,
  setModelOffset,
  setModelScale,
  turnModelAbout,
} from "./model-actions";
import { addReliefFinishOperation } from "./operation-actions";
import { setCustomXYOrigin, setStockDimension, setXYAnchor } from "./stock-actions";

/** The fixture's 100 × 80 × 12 mesh, without an id, placement or border. */
const { id: _, placement: __, border: ___, ...mesh } = model;

/** 600 × 400 × 18 mm stock zeroed at `anchor`, with the mesh imported. */
function storeWithModel(anchor: "bottom_left" | "center" = "bottom_left") {
  const document = createProjectDocument();
  document.stock.xyOrigin = { anchor };
  const store = createDocumentStore(document);
  const id = addModel(store, mesh) as string;
  const get = () => store.getState().document.models.find((m) => m.id === id) as Model;
  return { store, id, get };
}

describe("addModel", () => {
  it("fits inside the stock's border, aligned at the anchor, as one undo step", () => {
    const { store, get } = storeWithModel("center");
    // 100 × 80 into 600 × 400 less a 10 mm border: 4.75 times, 475 × 380, centred.
    expect(get().placement).toEqual({
      rotation: [0, 0, 0],
      scale: 4.75,
      // The mesh's 12 mm, scaled like its outline, deeper than the stock.
      depth: 57,
      position: [62.5, 10],
    });
    expect(ProjectDocument.safeParse(store.getState().document).success).toBe(true);
    store.getState().undo();
    expect(store.getState().document.models).toEqual([]);
  });

  it("adds no touch-off pad", () => {
    const { store } = storeWithModel("center");
    expect(store.getState().document.stock.touchOff).toBeNull();
  });

  it("aligns at the bottom-left corner with a custom zero", () => {
    const document = createProjectDocument();
    document.stock.xyOrigin = { anchor: "custom", x: 100, y: 100 };
    const store = createDocumentStore(document);
    addModel(store, mesh);
    expect(store.getState().document.models[0]?.placement.position).toEqual([10, 10]);
  });

  it("adds a model alongside other models and drawings", () => {
    const store = createDocumentStore(fullDocument());
    addModel(store, mesh);
    addModel(store, mesh);
    expect(store.getState().document.models).toHaveLength(2);
    expect(store.getState().document.geometry).toEqual(fullDocument().geometry);
  });
});

describe("placement edits", () => {
  it("turns about the stock's axes, keeping the anchor point", () => {
    const { store, id, get } = storeWithModel("center");
    turnModelAbout(store, id, 2);
    expect(get().placement.rotation).toEqual([0, 0, 90]);
    const { min, max } = modelRect(get());
    // 380 × 475 now, still centred on the stock.
    expectClose([min[0], min[1], max[0], max[1]], [110, -37.5, 490, 437.5]);
    expect(store.getState().past).toHaveLength(2);
  });

  it("scales in all three directions, so the mesh is never stretched", () => {
    const { store, id, get } = storeWithModel();
    setModelScale(store, id, 2);
    expect(get().placement).toMatchObject({ scale: 2, depth: 24, position: [10, 10] });
    setModelDepth(store, id, 6);
    expect(get().placement).toMatchObject({ scale: 0.5, depth: 6, position: [10, 10] });
    // Unchanged values add no undo step.
    const steps = store.getState().past.length;
    setModelScale(store, id, 0.5);
    setModelDepth(store, id, 6);
    expect(store.getState().past).toHaveLength(steps);
  });

  it("fits inside the stock's border again after turning", () => {
    const { store, id, get } = storeWithModel();
    setModelScale(store, id, 1);
    turnModelAbout(store, id, 2);
    fitModelToStock(store, id);
    // 80 × 100 into 580 × 380: 3.8 times.
    expect(get().placement).toMatchObject({ scale: 3.8, position: [10, 10] });
    expect(get().placement.depth).toBeCloseTo(45.6);
  });

  it("fits inside the model's own border, set as one undo step", () => {
    const { store, id, get } = storeWithModel();
    expect(get().border).toBe(10);
    const steps = store.getState().past.length;
    setModelBorder(store, id, 0);
    expect(get().border).toBe(0);
    expect(store.getState().past).toHaveLength(steps + 1);
    // Setting the border doesn't move the model; fitting does.
    expect(get().placement).toMatchObject({ scale: 4.75, position: [10, 10] });
    fitModelToStock(store, id);
    // 100 × 80 into 600 × 400 whole: 5 times, edge to edge in Y.
    expect(get().placement).toMatchObject({ scale: 5, position: [0, 0] });
    setModelBorder(store, id, 20);
    fitModelToStock(store, id);
    // Into 560 × 360: 4.5 times.
    expect(get().placement).toMatchObject({ scale: 4.5, position: [20, 20] });
    setModelBorder(store, id, 20);
    expect(store.getState().past).toHaveLength(steps + 4);
    store.getState().undo();
    store.getState().undo();
    expect(get().border).toBe(0);
  });

  it("moves the model's anchor point to a distance from the zero", () => {
    const { store, id, get } = storeWithModel("center");
    const stock = () => store.getState().document.stock;
    expect(modelOffset(stock(), get())).toEqual([0, 0]);
    setModelOffset(store, id, "x", 25);
    setModelOffset(store, id, "y", -10);
    expect(modelOffset(stock(), get())).toEqual([25, -10]);
    expect(get().placement.position).toEqual([87.5, 0]);
  });

  it("removes a model, undoably", () => {
    const { store, id } = storeWithModel();
    removeModel(store, id);
    expect(store.getState().document.models).toEqual([]);
    store.getState().undo();
    expect(store.getState().document.models).toHaveLength(1);
  });

  it("removes the operations that machine it with it", () => {
    const { store, id } = storeWithModel();
    addReliefFinishOperation(store, { modelId: id, tool: ballEndMill });
    expect(modelOperations(store.getState().document, id)).toHaveLength(1);
    removeModel(store, id);
    expect(store.getState().document.operations).toEqual([]);
    store.getState().undo();
    expect(store.getState().document.operations).toHaveLength(1);
  });
});

describe("models and the zero", () => {
  /**
   * The fixture's drawing on a 300 × 200 stock, zeroed at its bottom-left
   * corner, with a model beside it. Import allows only one of them for now,
   * but documents may hold both.
   */
  function designStore() {
    const document = fullDocument();
    document.stock.xyOrigin = { anchor: "bottom_left" };
    document.models = [{ ...model, placement: { ...model.placement, position: [150, 0] } }];
    const store = createDocumentStore(document);
    const get = () => store.getState().document.models[0] as Model;
    return { store, get };
  }

  it("moves with the drawing when an anchor is chosen, aligned as one design", () => {
    const { store, get } = designStore();
    const before = store.getState().document;
    const gap = (document: ProjectDocument, m: Model) => {
      const [x, y] = drawingAnchor(document, "bottom_left");
      return [m.placement.position[0] - x, m.placement.position[1] - y];
    };
    const relative = gap(before, get());
    setXYAnchor(store, "center");
    const after = store.getState().document;
    expectClose(gap(after, get()), relative);
    // One undo step puts both back.
    store.getState().undo();
    expect(store.getState().document).toEqual(before);
  });

  it("follows an anchored zero when the stock is resized, not a custom one", () => {
    const { store, get } = designStore();
    setXYAnchor(store, "center");
    const x = get().placement.position[0];
    setStockDimension(store, "width", 400);
    expect(get().placement.position[0]).toBeCloseTo(x + 50);
    setCustomXYOrigin(store);
    setStockDimension(store, "width", 500);
    expect(get().placement.position[0]).toBeCloseTo(x + 50);
  });
});
