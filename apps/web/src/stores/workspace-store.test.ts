import { describe, expect, it } from "vitest";
import { createWorkspaceStore } from "./workspace-store";

describe("workspace store", () => {
  it("replaces or toggles the shape selection", () => {
    const store = createWorkspaceStore();
    store.getState().selectShapes(["a", "b", "a"]);
    expect(store.getState().selectedShapeIds).toEqual(["a", "b"]);
    store.getState().selectShapes(["b", "c"], "toggle");
    expect(store.getState().selectedShapeIds).toEqual(["a", "c"]);
  });

  it("clears shapes and operation together", () => {
    const store = createWorkspaceStore();
    store.getState().selectShapes(["a"]);
    store.getState().selectOperation("op");
    store.getState().clearSelection();
    expect(store.getState()).toMatchObject({ selectedShapeIds: [], selectedOperationId: null });
  });
});
