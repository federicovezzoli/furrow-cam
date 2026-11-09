import { createProjectDocument, type ProjectDocument } from "@furrow/document";
import { describe, expect, it } from "vitest";
import { createWorkspaceStore } from "./workspace-store";

describe("workspace store", () => {
  const a0 = { shapeId: "a", path: 0 };
  const a1 = { shapeId: "a", path: 1 };
  const b0 = { shapeId: "b", path: 0 };

  it("shows the bottom side for viewing only, and only in a two-sided project", () => {
    const store = createWorkspaceStore();
    store.getState().setEditing("tabs");
    store.getState().setSide("bottom");
    expect(store.getState()).toMatchObject({ side: "bottom", editing: null });
    store.getState().setPickingZero(true);
    expect(store.getState()).toMatchObject({ side: "top", pickingZero: true });

    store.getState().setSide("bottom");
    const document = createProjectDocument();
    const twoSided = {
      ...document.stock,
      twoSided: { flipAxis: "x" as const, partingDepth: 9, tabs: null, lineUp: null },
    };
    store.getState().prune({ ...document, stock: twoSided });
    expect(store.getState().side).toBe("bottom");
    store.getState().prune(document);
    expect(store.getState().side).toBe("top");
  });

  it("replaces the path selection", () => {
    const store = createWorkspaceStore();
    store.getState().selectPaths([a0, b0, { ...a0 }]);
    expect(store.getState().selectedPaths).toEqual([a0, b0]);
    store.getState().selectPaths([a1]);
    expect(store.getState().selectedPaths).toEqual([a1]);
    store.getState().selectPaths([]);
    expect(store.getState().selectedPaths).toEqual([]);
  });

  it("toggles paths: off when all are selected, otherwise on", () => {
    const store = createWorkspaceStore();
    store.getState().selectPaths([a0]);
    store.getState().selectPaths([b0], "toggle");
    expect(store.getState().selectedPaths).toEqual([a0, b0]);
    store.getState().selectPaths([{ ...a0 }], "toggle");
    expect(store.getState().selectedPaths).toEqual([b0]);
    // A shape with some paths selected: toggling all its paths selects the rest.
    store.getState().selectPaths([a0, a1], "toggle");
    expect(store.getState().selectedPaths).toEqual([b0, a0, a1]);
    store.getState().selectPaths([a0, a1], "toggle");
    expect(store.getState().selectedPaths).toEqual([b0]);
  });

  it("clears shapes and operation together", () => {
    const store = createWorkspaceStore();
    store.getState().selectPaths([a0]);
    store.getState().selectOperation("op");
    store.getState().clearSelection();
    expect(store.getState()).toMatchObject({ selectedPaths: [], selectedOperationId: null });
  });

  it("selects a model or paths, not both", () => {
    const store = createWorkspaceStore();
    store.getState().setPickingZero(true);
    store.getState().selectPaths([a0]);
    store.getState().selectModel("model");
    expect(store.getState()).toMatchObject({
      selectedModelId: "model",
      selectedPaths: [],
      pickingZero: false,
    });
    store.getState().selectPaths([b0], "toggle");
    expect(store.getState()).toMatchObject({ selectedModelId: null, selectedPaths: [b0] });
    store.getState().selectModel("model");
    store.getState().clearSelection();
    expect(store.getState().selectedModelId).toBeNull();
  });

  it("shows a model's placement or an operation's properties, not both", () => {
    const store = createWorkspaceStore();
    store.getState().selectOperation("op");
    store.getState().selectModel("model");
    expect(store.getState()).toMatchObject({ selectedModelId: "model", selectedOperationId: null });
    store.getState().selectOperation("op");
    expect(store.getState()).toMatchObject({ selectedModelId: null, selectedOperationId: "op" });
  });

  it("drops a selected model that is no longer in the document", () => {
    const store = createWorkspaceStore();
    store.getState().selectModel("model");
    store.getState().prune(createProjectDocument());
    expect(store.getState().selectedModelId).toBeNull();
  });

  it("shows or hides several toolpaths at once", () => {
    const store = createWorkspaceStore();
    store.getState().setToolpathVisible("a", false);
    store.getState().setToolpathsVisible(["a", "b", "c"], false);
    expect(store.getState().hiddenToolpathIds).toEqual(["a", "b", "c"]);
    store.getState().setToolpathsVisible(["a", "b"], true);
    expect(store.getState().hiddenToolpathIds).toEqual(["c"]);
  });

  it("simulates instead of editing tabs or picking the zero", () => {
    const store = createWorkspaceStore();
    expect(store.getState().simulating).toBe(false);
    store.getState().setEditing("tabs");
    store.getState().setSimulating(true);
    expect(store.getState()).toMatchObject({ simulating: true, editing: null });
    store.getState().setPickingZero(true);
    expect(store.getState()).toMatchObject({ simulating: false, pickingZero: true });
    store.getState().setSimulating(true);
    expect(store.getState().pickingZero).toBe(false);
    store.getState().setEditing("tabs");
    expect(store.getState().simulating).toBe(false);
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
    store.getState().setEditing("tabs");
    expect(store.getState()).toMatchObject({ editing: "tabs", view: "top" });
    store.getState().selectOperation("op");
    expect(store.getState().editing).toBe("tabs");
    store.getState().setView("orbit");
    expect(store.getState().editing).toBeNull();

    store.getState().setEditing("tabs");
    store.getState().selectOperation("other");
    expect(store.getState().editing).toBeNull();
    store.getState().setEditing("tabs");
    store.getState().clearSelection();
    expect(store.getState().editing).toBeNull();
  });

  it("picks the zero only in the top view, until the view, the selection or tab editing changes", () => {
    const store = createWorkspaceStore();
    store.getState().setView("orbit");
    store.getState().setPickingZero(true);
    expect(store.getState()).toMatchObject({ pickingZero: true, view: "top" });
    store.getState().setView("orbit");
    expect(store.getState().pickingZero).toBe(false);

    store.getState().setPickingZero(true);
    store.getState().selectPaths([a0]);
    expect(store.getState().pickingZero).toBe(false);
    store.getState().clearSelection();
    store.getState().setPickingZero(true);
    store.getState().selectOperation("op");
    expect(store.getState().pickingZero).toBe(false);

    store.getState().setPickingZero(true);
    store.getState().setEditing("tabs");
    expect(store.getState()).toMatchObject({ pickingZero: false, editing: "tabs" });
    store.getState().setPickingZero(true);
    expect(store.getState()).toMatchObject({ pickingZero: true, editing: null });
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
    store.getState().setEditing("tabs");
    store.getState().prune(withTabs({ width: 6, height: 3, positions: [] }));
    expect(store.getState().editing).toBe("tabs");
    store.getState().prune(withTabs(null));
    expect(store.getState()).toMatchObject({ editing: null, selectedOperationId: "op" });
    // Start points need only a profile or an engraving.
    store.getState().setEditing("startPoints");
    store.getState().prune(withTabs(null));
    expect(store.getState().editing).toBe("startPoints");
    store.getState().prune(createProjectDocument());
    expect(store.getState().editing).toBeNull();
    // Overcut editing ends with the overcuts.
    const withOvercuts = (cornerOvercuts: unknown) => ({
      ...createProjectDocument(),
      operations: [
        {
          id: "op",
          type: "profile",
          params: { cornerOvercuts },
        } as ProjectDocument["operations"][number],
      ],
    });
    store.getState().selectOperation("op");
    store.getState().setEditing("overcuts");
    store.getState().prune(withOvercuts({ maxAngle: 90, excluded: [] }));
    expect(store.getState().editing).toBe("overcuts");
    store.getState().prune(withOvercuts(null));
    expect(store.getState().editing).toBeNull();
    // Placing holes needs a drill of shapes, not of the locating pins.
    const withDrill = (pins: boolean) => ({
      ...createProjectDocument(),
      operations: [
        { id: "op", type: "drill", params: { pins } } as ProjectDocument["operations"][number],
      ],
    });
    store.getState().setEditing("holes");
    store.getState().prune(withDrill(false));
    expect(store.getState().editing).toBe("holes");
    store.getState().prune(withDrill(true));
    expect(store.getState().editing).toBeNull();
  });

  it("prunes ids and paths that are no longer in the document, keeping an unchanged selection", () => {
    const store = createWorkspaceStore();
    const shape = (id: string) =>
      ({ id, paths: id === "a" ? [{}, {}] : [{}] }) as ProjectDocument["geometry"][number];
    const operation = (id: string) => ({ id }) as ProjectDocument["operations"][number];
    const document = (shapes: string[], operations: string[]): ProjectDocument => ({
      ...createProjectDocument(),
      geometry: shapes.map(shape),
      operations: operations.map(operation),
    });
    store.getState().selectPaths([a0, a1, b0]);
    store.getState().selectOperation("op");
    store.getState().setHovered({ shapeId: "b", path: 0 });
    store.getState().setEditing("tabs");
    store.getState().setToolpathVisible("op", false);

    const selected = store.getState().selectedPaths;
    store.getState().prune(document(["a", "b"], ["op"]));
    expect(store.getState().selectedPaths).toBe(selected);
    expect(store.getState().hovered).toEqual({ shapeId: "b", path: 0 });

    store.getState().prune(document(["a"], []));
    expect(store.getState()).toMatchObject({
      selectedPaths: [a0, a1],
      selectedOperationId: null,
      hovered: null,
      editing: null,
      hiddenToolpathIds: [],
    });
  });

  it("leaves an entered drawing when the top view stops taking clicks, keeping the paths", () => {
    const store = createWorkspaceStore();
    const enter = () => {
      store.getState().enterDrawing("d");
      store.getState().selectPaths([a0]);
    };
    enter();
    store.getState().enterDrawing(null);
    expect(store.getState()).toMatchObject({ enteredDrawingId: null, selectedPaths: [a0] });

    for (const leave of [
      () => store.getState().setView("orbit"),
      () => store.getState().setEditing("tabs"),
      () => store.getState().setPickingZero(true),
      () => store.getState().selectModel("m"),
      () => store.getState().clearSelection(),
    ]) {
      store.getState().setView("top");
      store.getState().setEditing(null);
      store.getState().setPickingZero(false);
      enter();
      leave();
      expect(store.getState().enteredDrawingId).toBeNull();
    }
  });

  it("drops what becomes hidden from the selection (ADR-0080)", () => {
    const store = createWorkspaceStore();
    const document = createProjectDocument();
    const shapes = ["a", "b"].map(
      (id) =>
        ({ id, drawingId: "d", paths: [{}] }) as unknown as ProjectDocument["geometry"][number],
    );
    const drawing = { id: "d" } as ProjectDocument["drawings"][number];
    const model = { id: "m" } as ProjectDocument["models"][number];
    store.getState().enterDrawing("d");
    store.getState().selectPaths([a0, b0]);
    store.getState().prune({
      ...document,
      drawings: [drawing],
      geometry: [shapes[0], { ...shapes[1], hidden: true }] as ProjectDocument["geometry"],
    });
    expect(store.getState()).toMatchObject({ selectedPaths: [a0], enteredDrawingId: "d" });
    store.getState().prune({
      ...document,
      drawings: [{ ...drawing, hidden: true }],
      geometry: shapes as ProjectDocument["geometry"],
    });
    expect(store.getState()).toMatchObject({ selectedPaths: [], enteredDrawingId: null });

    store.getState().selectModel("m");
    store.getState().prune({ ...document, models: [{ ...model, hidden: true }] });
    expect(store.getState().selectedModelId).toBeNull();
  });

  it("leaves an entered drawing that is no longer in the document", () => {
    const store = createWorkspaceStore();
    const document = createProjectDocument();
    const drawing = { id: "d" } as ProjectDocument["drawings"][number];
    store.getState().enterDrawing("d");
    store.getState().prune({ ...document, drawings: [drawing] });
    expect(store.getState().enteredDrawingId).toBe("d");
    store.getState().prune(document);
    expect(store.getState().enteredDrawingId).toBeNull();
  });

  it("drops hovered paths past a shape's paths", () => {
    const store = createWorkspaceStore();
    const geometry = [{ id: "a", paths: [{}] }] as ProjectDocument["geometry"];
    store.getState().setHovered({ shapeId: "a", path: 0 });
    store.getState().prune({ ...createProjectDocument(), geometry });
    expect(store.getState().hovered).toEqual({ shapeId: "a", path: 0 });
    store.getState().setHovered({ shapeId: "a", path: 1 });
    store.getState().prune({ ...createProjectDocument(), geometry });
    expect(store.getState().hovered).toBeNull();
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
