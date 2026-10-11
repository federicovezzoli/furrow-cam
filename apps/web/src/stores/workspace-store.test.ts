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

  it("picks the zero only in the top view, until the view, the selection or tab editing changes", () => {
    const store = createWorkspaceStore();
    store.getState().setView("orbit");
    store.getState().setPickingZero(true);
    expect(store.getState()).toMatchObject({ pickingZero: true, view: "top" });
    store.getState().setView("orbit");
    expect(store.getState().pickingZero).toBe(false);

    store.getState().setPickingZero(true);
    store.getState().selectShapes(["a"]);
    expect(store.getState().pickingZero).toBe(false);
    store.getState().clearSelection();
    store.getState().setPickingZero(true);
    store.getState().selectOperation("op");
    expect(store.getState().pickingZero).toBe(false);

    store.getState().setPickingZero(true);
    store.getState().setEditingTabs(true);
    expect(store.getState()).toMatchObject({ pickingZero: false, editingTabs: true });
    store.getState().setPickingZero(true);
    expect(store.getState()).toMatchObject({ pickingZero: true, editingTabs: false });
    store.getState().setPickingZero(false);
    expect(store.getState().pickingZero).toBe(false);
  });

  it("stops picking the zero once it isn't custom", () => {
    const store = createWorkspaceStore();
    const document = createProjectDocument();
    store.getState().setPickingZero(true);
    store.getState().prune({
      ...document,
      stock: { ...document.stock, xyOrigin: { anchor: "custom", x: 1, y: 2 } },
    });
    expect(store.getState().pickingZero).toBe(true);
    store.getState().prune(document);
    expect(store.getState().pickingZero).toBe(false);
  });

  it("stops editing tabs once the selected profile has none", () => {
    const store = createWorkspaceStore();
    const withTabs = (tabs: object | null): ProjectDocument => ({
      ...createProjectDocument(),
      operations: [
        { id: "op", type: "profile", params: { tabs } } as ProjectDocument["operations"][number],
      ],
    });
    store.getState().selectOperation("op");
    store.getState().setEditingTabs(true);
    store.getState().prune(withTabs({ width: 6, height: 3, positions: [] }));
    expect(store.getState().editingTabs).toBe(true);
    store.getState().prune(withTabs(null));
    expect(store.getState()).toMatchObject({ editingTabs: false, selectedOperationId: "op" });
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
    store.getState().setToolpathVisible("op", false);

    const selected = store.getState().selectedShapeIds;
    store.getState().prune(document(["a", "b"], ["op"]));
    expect(store.getState().selectedShapeIds).toBe(selected);

    store.getState().prune(document(["a"], []));
    expect(store.getState()).toMatchObject({
      selectedShapeIds: ["a"],
      selectedOperationId: null,
      hoveredShapeId: null,
      editingTabs: false,
      hiddenToolpathIds: [],
    });
  });

  it("hides and shows an operation's toolpath", () => {
    const store = createWorkspaceStore();
    expect(store.getState().hiddenToolpathIds).toEqual([]);
    store.getState().setToolpathVisible("a", false);
    store.getState().setToolpathVisible("a", false);
    store.getState().setToolpathVisible("b", false);
    expect(store.getState().hiddenToolpathIds).toEqual(["a", "b"]);
    store.getState().setToolpathVisible("a", true);
    expect(store.getState().hiddenToolpathIds).toEqual(["b"]);
  });
});
