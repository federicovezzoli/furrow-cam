import { createProjectDocument, ProjectDocument, type Shape, type Tool } from "@furrow/document";
import { describe, expect, it } from "vitest";
import { createDocumentStore } from "./document-store";
import {
  addProfileOperation,
  deleteOperation,
  moveOperation,
  renameOperation,
  setOperationEnabled,
  setOperationShapes,
  setOperationTool,
  updateProfileParams,
} from "./operation-actions";

const MISSING_ID = "11111111-2222-4333-8444-555555555555";

const endMill: Tool = {
  name: "6 mm upcut",
  type: "flat_end_mill",
  diameter: 6,
  fluteCount: 2,
  fluteLength: 22,
  cutDirection: "upcut",
  vAngle: null,
  tipDiameter: null,
  spindleRpm: 24000,
  feedRate: 600,
  plungeRate: 300,
  plungeAngle: 3,
  stepDown: 1,
  stepOver: 40,
  notes: null,
  color: "#2563eb",
};

const vBit: Tool = {
  ...endMill,
  name: "60° V-bit",
  type: "v_bit",
  cutDirection: null,
  vAngle: 60,
  tipDiameter: 0,
};

const square: Shape = {
  id: "4f8a1c2e-6b3d-4e5f-9a7b-8c9d0e1f2a3b",
  name: "Square",
  layer: "0",
  paths: [
    {
      start: [10, 10],
      segments: [
        { kind: "line", to: [60, 10] },
        { kind: "line", to: [60, 60] },
        { kind: "line", to: [10, 60] },
      ],
      closed: true,
    },
  ],
};

const circle: Shape = {
  id: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
  name: "Hole",
  layer: "0",
  paths: [
    {
      start: [110, 50],
      segments: [{ kind: "arc", to: [110, 50], center: [100, 50], clockwise: false }],
      closed: true,
    },
  ],
};

function setup() {
  const store = createDocumentStore({
    ...createProjectDocument(),
    geometry: [square, circle],
  });
  const document = () => store.getState().document;
  const operations = () => document().operations;
  const add = (shapeIds = [square.id]) => {
    const id = addProfileOperation(store, { shapeIds, tool: endMill });
    if (!id) throw new Error("not added");
    return id;
  };
  const profile = (id: string) => {
    const operation = operations().find((candidate) => candidate.id === id);
    if (operation?.type !== "profile") throw new Error("no profile");
    return operation;
  };
  return { store, document, operations, add, profile };
}

describe("addProfileOperation", () => {
  it("appends a valid, enabled profile through the stock with the tool", () => {
    const { store, document, add, profile } = setup();
    const id = add([circle.id, square.id, MISSING_ID]);
    expect(profile(id)).toMatchObject({
      name: "Profile 1",
      enabled: true,
      shapeIds: [square.id, circle.id],
      tool: endMill,
      params: { side: "outside", direction: "climb", depth: 18, allowance: 0, finishPass: false },
    });
    expect(ProjectDocument.parse(document())).toEqual(document());
    expect(store.getState().past).toHaveLength(1);
  });

  it("numbers names after the ones in use", () => {
    const { store, operations, add } = setup();
    const first = add();
    add();
    renameOperation(store, first, "Outline");
    add();
    expect(operations().map((operation) => operation.name)).toEqual([
      "Outline",
      "Profile 2",
      "Profile 1",
    ]);
  });

  it("adds nothing without shapes that exist", () => {
    const { store, operations } = setup();
    expect(addProfileOperation(store, { shapeIds: [MISSING_ID], tool: endMill })).toBeNull();
    expect(operations()).toEqual([]);
    expect(store.getState().past).toEqual([]);
  });
});

describe("operation edits", () => {
  it("renames, rejecting blank names", () => {
    const { store, add, profile } = setup();
    const id = add();
    expect(renameOperation(store, id, "Outline")).toEqual({ ok: true });
    expect(renameOperation(store, id, "  ")).toMatchObject({ ok: false });
    expect(profile(id).name).toBe("Outline");
  });

  it("enables and disables", () => {
    const { store, add, profile } = setup();
    const id = add();
    setOperationEnabled(store, id, false);
    expect(profile(id).enabled).toBe(false);
  });

  it("reorders within the list", () => {
    const { store, operations, add } = setup();
    const [a, b, c] = [add(), add(), add()];
    moveOperation(store, c, 0);
    expect(operations().map((operation) => operation.id)).toEqual([c, a, b]);
    moveOperation(store, c, 99);
    expect(operations().map((operation) => operation.id)).toEqual([a, b, c]);
    const before = store.getState().past.length;
    moveOperation(store, c, 2);
    expect(store.getState().past).toHaveLength(before);
  });

  it("deletes, and undo brings it back in place", () => {
    const { store, operations, add } = setup();
    const [a, b] = [add(), add()];
    deleteOperation(store, a);
    expect(operations().map((operation) => operation.id)).toEqual([b]);
    store.getState().undo();
    expect(operations().map((operation) => operation.id)).toEqual([a, b]);
  });

  it("replaces the tool snapshot", () => {
    const { store, add, profile } = setup();
    const id = add();
    setOperationTool(store, id, vBit);
    expect(profile(id).tool).toEqual(vBit);
  });

  it("sets the shapes, rejecting none", () => {
    const { store, add, profile } = setup();
    const id = add();
    expect(setOperationShapes(store, id, [circle.id, MISSING_ID])).toEqual({ ok: true });
    expect(profile(id).shapeIds).toEqual([circle.id]);
    expect(setOperationShapes(store, id, [MISSING_ID])).toMatchObject({ ok: false });
    expect(profile(id).shapeIds).toEqual([circle.id]);
  });

  it("does nothing to operations that no longer exist", () => {
    const { store, add } = setup();
    add();
    const before = store.getState().document;
    setOperationEnabled(store, MISSING_ID, false);
    moveOperation(store, MISSING_ID, 0);
    deleteOperation(store, MISSING_ID);
    expect(store.getState().document).toBe(before);
  });
});

describe("updateProfileParams", () => {
  it("changes several params as one undo step", () => {
    const { store, add, profile } = setup();
    const id = add();
    const result = updateProfileParams(store, id, {
      side: "inside",
      allowance: 0.5,
      finishPass: true,
      leadIn: { radius: 3 },
    });
    expect(result).toEqual({ ok: true });
    expect(profile(id).params).toMatchObject({ side: "inside", allowance: 0.5, finishPass: true });
    store.getState().undo();
    expect(profile(id).params).toMatchObject({ side: "outside", allowance: 0, finishPass: false });
  });

  it("rejects invalid params and changes nothing", () => {
    const { store, add, profile } = setup();
    const id = add();
    const before = profile(id).params;
    expect(updateProfileParams(store, id, { depth: 0 })).toMatchObject({ ok: false });
    expect(updateProfileParams(store, id, { finishPass: true })).toEqual({
      ok: false,
      error: "Needs an allowance to remove",
    });
    expect(updateProfileParams(store, id, { side: "on", allowance: 1 })).toMatchObject({
      ok: false,
    });
    expect(profile(id).params).toBe(before);
  });

  it("records nothing for unchanged values", () => {
    const { store, add } = setup();
    const id = add();
    const before = store.getState().past.length;
    updateProfileParams(store, id, { side: "outside" });
    expect(store.getState().past).toHaveLength(before);
  });
});
