import { createProjectDocument, type ProjectDocument } from "@furrow/document";
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

  it("starts in the top view and switches to the orbit view", () => {
    const store = createWorkspaceStore();
    expect(store.getState().view).toBe("top");
    store.getState().setView("orbit");
    expect(store.getState().view).toBe("orbit");
  });

  it("edits tabs only in the top view, until the operation or the view changes", () => {
    const store = createWorkspaceStore();
    store.getState().setView("orbit");
    store.getState().selectOperation("op");
    store.getState().setEditingTabs(true);
    expect(store.getState()).toMatchObject({ editingTabs: true, view: "top" });
    store.getState().selectOperation("op");
    expect(store.getState().editingTabs).toBe(true);
    store.getState().setView("orbit");
    expect(store.getState().editingTabs).toBe(false);

    store.getState().setEditingTabs(true);
    store.getState().selectOperation("other");
    expect(store.getState().editingTabs).toBe(false);
    store.getState().setEditingTabs(true);
    store.getState().clearSelection();
    expect(store.getState().editingTabs).toBe(false);
  });

  it("prunes ids that are no longer in the document, keeping an unchanged selection", () => {
    const store = createWorkspaceStore();
    const shape = (id: string) => ({ id }) as ProjectDocument["geometry"][number];
    const operation = (id: string) => ({ id }) as ProjectDocument["operations"][number];
    const document = (shapes: string[], operations: string[]): ProjectDocument => ({
      ...createProjectDocument(),
      geometry: shapes.map(shape),
      operations: operations.map(operation),
    });
    store.getState().selectShapes(["a", "b"]);
    store.getState().selectOperation("op");
    store.getState().setHoveredShape("b");
    store.getState().setEditingTabs(true);

    const selected = store.getState().selectedShapeIds;
    store.getState().prune(document(["a", "b"], ["op"]));
    expect(store.getState().selectedShapeIds).toBe(selected);

    store.getState().prune(document(["a"], []));
    expect(store.getState()).toMatchObject({
      selectedShapeIds: ["a"],
      selectedOperationId: null,
      hoveredShapeId: null,
      editingTabs: false,
    });
  });
});
