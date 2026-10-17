import {
  createProjectDocument,
  type OperationTarget,
  type PocketParams,
  ProjectDocument,
  type Shape,
  type Tool,
} from "@furrow/document";
import { model } from "@furrow/document/fixtures";
import { describe, expect, it } from "vitest";
import { createDocumentStore } from "./document-store";
import {
  addDrillOperation,
  addEngraveOperation,
  addPocketOperation,
  addProfileOperation,
  addReliefFinishOperation,
  addReliefRoughOperation,
  addTab,
  addVCarveOperation,
  autoPlaceTabs,
  defaultTabs,
  deleteOperation,
  moveOperation,
  moveTab,
  removeTab,
  renameOperation,
  replaceToolSnapshots,
  setOperationEnabled,
  setOperationTargets,
  setOperationTool,
  updateDrillParams,
  updateEngraveParams,
  updatePocketParams,
  updateProfileParams,
  updateReliefFinishParams,
  updateReliefRoughParams,
  updateVCarveParams,
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

/** A part in one shape, as an OpenSCAD export has it: an outline and two holes. */
const plate: Shape = {
  id: "0d9c8b7a-6f5e-4d3c-ab1a-0f9e8d7c6b5a",
  name: "Plate",
  layer: "0",
  paths: [
    {
      start: [200, 0],
      segments: [
        { kind: "line", to: [300, 0] },
        { kind: "line", to: [300, 60] },
        { kind: "line", to: [200, 60] },
      ],
      closed: true,
    },
    ...[220, 280].map((x) => ({
      start: [x + 5, 30] as [number, number],
      segments: [
        {
          kind: "arc" as const,
          to: [x + 5, 30] as [number, number],
          center: [x, 30] as [number, number],
          clockwise: false,
        },
      ],
      closed: true,
    })),
  ],
};

const whole = (shape: Shape): OperationTarget => ({ shapeId: shape.id, paths: null });
const missing = { shapeId: MISSING_ID, paths: null };

function setup() {
  const store = createDocumentStore({
    ...createProjectDocument(),
    geometry: [square, circle, plate],
    models: [],
  });
  const document = () => store.getState().document;
  const operations = () => document().operations;
  const add = (targets: OperationTarget[] = [whole(square)]) => {
    const id = addProfileOperation(store, { targets, tool: endMill });
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
    const id = add([whole(circle), whole(square), missing]);
    expect(profile(id)).toMatchObject({
      name: "Profile 1",
      enabled: true,
      targets: [whole(square), whole(circle)],
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
    expect(addProfileOperation(store, { targets: [missing], tool: endMill })).toBeNull();
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

  it("sets the targets, rejecting none", () => {
    const { store, add, profile } = setup();
    const id = add();
    expect(setOperationTargets(store, id, [whole(circle), missing])).toEqual({ ok: true });
    expect(profile(id).targets).toEqual([whole(circle)]);
    expect(setOperationTargets(store, id, [missing])).toMatchObject({ ok: false });
    expect(setOperationTargets(store, id, [{ shapeId: plate.id, paths: [7] }])).toMatchObject({
      ok: false,
    });
    expect(profile(id).targets).toEqual([whole(circle)]);
  });

  it("keeps targeted paths that exist, ascending, whole once all are targeted", () => {
    const { store, document, add, profile } = setup();
    const id = add([{ shapeId: plate.id, paths: [2, 0, 9] }]);
    expect(profile(id).targets).toEqual([{ shapeId: plate.id, paths: [0, 2] }]);
    expect(ProjectDocument.parse(document())).toEqual(document());
    setOperationTargets(store, id, [
      { shapeId: plate.id, paths: [2] },
      { shapeId: plate.id, paths: [0, 1] },
      { shapeId: square.id, paths: [0] },
    ]);
    expect(profile(id).targets).toEqual([whole(square), whole(plate)]);
  });

  it("cuts only the targeted paths", () => {
    const { document, add, profile } = setup();
    const id = add([{ shapeId: plate.id, paths: [1, 2] }]);
    const tabs = defaultTabs(document(), profile(id));
    // Four tabs on each of the two holes, none on the outline.
    expect(tabs.positions).toHaveLength(8);
    for (const [x] of tabs.positions) expect(x).toBeGreaterThan(200);
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

describe("addPocketOperation", () => {
  it("appends a valid pocket half through the stock, ramping in", () => {
    const { store, document, operations } = setup();
    const id = addPocketOperation(store, { targets: [whole(square)], tool: endMill });
    expect(operations().find((operation) => operation.id === id)).toMatchObject({
      type: "pocket",
      name: "Pocket 1",
      enabled: true,
      targets: [whole(square)],
      tool: endMill,
      params: {
        strategy: { type: "offset" },
        direction: "climb",
        depth: 9,
        allowance: 0,
        finishPass: false,
        ramp: true,
      },
    });
    expect(ProjectDocument.parse(document())).toEqual(document());
    expect(addPocketOperation(store, { targets: [missing], tool: endMill })).toBeNull();
  });
});

describe("addDrillOperation", () => {
  const addDrill = (store: ReturnType<typeof setup>["store"]) => {
    const id = addDrillOperation(store, { targets: [whole(circle)], tool: endMill });
    if (!id) throw new Error("not added");
    return id;
  };

  it("appends a valid drill operation through the stock, pecking", () => {
    const { store, document, operations } = setup();
    const id = addDrill(store);
    expect(operations().find((operation) => operation.id === id)).toMatchObject({
      type: "drill",
      name: "Drill 1",
      enabled: true,
      targets: [whole(circle)],
      tool: endMill,
      params: { depth: 18, peck: true },
    });
    expect(ProjectDocument.parse(document())).toEqual(document());
  });

  it("refuses V-bits, adding or switching tools", () => {
    const { store, operations } = setup();
    expect(addDrillOperation(store, { targets: [whole(circle)], tool: vBit })).toBeNull();
    const id = addDrill(store);
    expect(setOperationTool(store, id, vBit)).toEqual({ ok: false, error: "V-bits can't drill" });
    expect(operations().find((operation) => operation.id === id)?.tool).toEqual(endMill);
  });

  it("updates its params, rejecting invalid ones", () => {
    const { store, operations } = setup();
    const id = addDrill(store);
    expect(updateDrillParams(store, id, { depth: 5, peck: false })).toEqual({ ok: true });
    expect(operations().find((operation) => operation.id === id)?.params).toEqual({
      depth: 5,
      peck: false,
    });
    expect(updateDrillParams(store, id, { depth: -1 })).toMatchObject({ ok: false });
  });
});

describe("addEngraveOperation", () => {
  const addEngrave = (store: ReturnType<typeof setup>["store"], tool: Tool = vBit) => {
    const id = addEngraveOperation(store, { targets: [whole(square)], tool });
    if (!id) throw new Error("not added");
    return id;
  };

  it("appends a valid engrave operation on the line, 1 mm deep, plunging", () => {
    const { store, document, operations } = setup();
    const id = addEngrave(store);
    expect(operations().find((operation) => operation.id === id)).toMatchObject({
      type: "engrave",
      name: "Engrave 1",
      enabled: true,
      targets: [whole(square)],
      tool: vBit,
      params: { side: "on", depth: 1, ramp: false },
    });
    expect(ProjectDocument.parse(document())).toEqual(document());
  });

  it("refuses drill bits, adding or switching tools", () => {
    const { store, operations } = setup();
    const drillBit: Tool = { ...endMill, type: "drill", cutDirection: null, plungeAngle: 90 };
    expect(addEngraveOperation(store, { targets: [whole(square)], tool: drillBit })).toBeNull();
    const id = addEngrave(store, endMill);
    expect(setOperationTool(store, id, drillBit)).toEqual({
      ok: false,
      error: "Drill bits can't engrave",
    });
    expect(operations().find((operation) => operation.id === id)?.tool).toEqual(endMill);
  });

  it("updates its params, rejecting invalid ones", () => {
    const { store, operations } = setup();
    const id = addEngrave(store);
    expect(updateEngraveParams(store, id, { side: "inside", depth: 0.4, ramp: true })).toEqual({
      ok: true,
    });
    expect(operations().find((operation) => operation.id === id)?.params).toEqual({
      side: "inside",
      depth: 0.4,
      ramp: true,
    });
    expect(updateEngraveParams(store, id, { depth: 0 })).toMatchObject({ ok: false });
  });
});

describe("addVCarveOperation", () => {
  const addVCarve = (store: ReturnType<typeof setup>["store"]) => {
    const id = addVCarveOperation(store, { targets: [whole(square)], tool: vBit });
    if (!id) throw new Error("not added");
    return id;
  };

  it("appends a valid V-carve as deep as the bit's cone, without a flat bottom", () => {
    const { store, document, operations } = setup();
    const id = addVCarve(store);
    const operation = operations().find((candidate) => candidate.id === id);
    expect(operation).toMatchObject({
      type: "vcarve",
      name: "V-carve 1",
      enabled: true,
      targets: [whole(square)],
      tool: vBit,
      params: { flatBottom: null },
    });
    // A 6 mm 60° bit reaches its full width 3 / tan 30° deep.
    expect(operation?.params).toHaveProperty("maxDepth", 3 / Math.tan(Math.PI / 6));
    expect(ProjectDocument.parse(document())).toEqual(document());
  });

  it("goes no deeper than half the stock", () => {
    const { store, operations } = setup();
    store.getState().change("thin", (draft) => {
      draft.stock.thickness = 4;
    });
    addVCarve(store);
    expect(operations()[0]?.params).toEqual({ maxDepth: 2, flatBottom: null });
  });

  it("takes V-bits only, adding or switching tools", () => {
    const { store, operations } = setup();
    expect(addVCarveOperation(store, { targets: [whole(square)], tool: endMill })).toBeNull();
    const id = addVCarve(store);
    expect(setOperationTool(store, id, endMill)).toEqual({
      ok: false,
      error: "Only V-bits V-carve",
    });
    expect(operations()[0]?.tool).toEqual(vBit);
  });

  it("updates its params, flat bottom included, rejecting invalid ones", () => {
    const { store, operations } = setup();
    const id = addVCarve(store);
    expect(updateVCarveParams(store, id, { maxDepth: 2, flatBottom: { tool: endMill } })).toEqual({
      ok: true,
    });
    expect(operations()[0]?.params).toEqual({ maxDepth: 2, flatBottom: { tool: endMill } });
    expect(updateVCarveParams(store, id, { maxDepth: 0 })).toMatchObject({ ok: false });
    expect(updateVCarveParams(store, id, { flatBottom: { tool: vBit } })).toEqual({
      ok: false,
      error: "Only flat end mills clear a flat bottom",
    });
  });
});

describe("addReliefFinishOperation", () => {
  function storeWithModel() {
    return createDocumentStore({ ...createProjectDocument(), models: [model] });
  }

  it("appends a valid zig-zag finish of the model at a 10% step-over", () => {
    const store = storeWithModel();
    const id = addReliefFinishOperation(store, { modelId: model.id, tool: endMill });
    const { document } = store.getState();
    expect(ProjectDocument.safeParse(document).success).toBe(true);
    expect(document.operations[0]).toMatchObject({
      id,
      type: "relief_finish",
      name: "3D finish 1",
      targets: [],
      tool: endMill,
      params: {
        modelId: model.id,
        strategy: { type: "parallel", angle: 0, direction: "zigzag" },
        stepOver: 10,
        stockToLeave: 0,
        rest: false,
      },
    });
  });

  it("adds nothing for a model that isn't there", () => {
    const store = storeWithModel();
    expect(addReliefFinishOperation(store, { modelId: MISSING_ID, tool: endMill })).toBeNull();
    expect(store.getState().document.operations).toEqual([]);
  });

  it("updates its params, rejecting invalid ones", () => {
    const store = storeWithModel();
    const id = addReliefFinishOperation(store, { modelId: model.id, tool: endMill }) as string;
    expect(
      updateReliefFinishParams(store, id, {
        strategy: { type: "parallel", angle: 45, direction: "one_way" },
        rest: true,
      }),
    ).toEqual({ ok: true });
    expect(
      updateReliefFinishParams(store, id, { strategy: { type: "waterline", stepDown: 0 } }),
    ).toMatchObject({ ok: false });
    expect(updateReliefFinishParams(store, id, { stepOver: 0 })).toMatchObject({ ok: false });
    expect(updateReliefFinishParams(store, id, { stockToLeave: -1 })).toMatchObject({ ok: false });
    expect(store.getState().document.operations[0]?.params).toMatchObject({
      strategy: { type: "parallel", angle: 45, direction: "one_way" },
      stepOver: 10,
      stockToLeave: 0,
      rest: true,
    });
  });
});

describe("addReliefRoughOperation", () => {
  function storeWithModel() {
    return createDocumentStore({ ...createProjectDocument(), models: [model] });
  }

  it("appends a valid roughing of the model's outline, leaving 0.5 mm", () => {
    const store = storeWithModel();
    const id = addReliefRoughOperation(store, { modelId: model.id, tool: endMill });
    const { document } = store.getState();
    expect(ProjectDocument.safeParse(document).success).toBe(true);
    expect(document.operations[0]).toMatchObject({
      id,
      type: "relief_rough",
      name: "3D rough 1",
      targets: [],
      tool: endMill,
      params: {
        modelId: model.id,
        strategy: { type: "offset" },
        direction: "climb",
        stepOver: null,
        stockToLeave: 0.5,
        boundary: { type: "model" },
        ramp: true,
        rest: false,
      },
    });
  });

  it("adds nothing for a model that isn't there", () => {
    const store = storeWithModel();
    expect(addReliefRoughOperation(store, { modelId: MISSING_ID, tool: endMill })).toBeNull();
    expect(store.getState().document.operations).toEqual([]);
  });

  it("updates its params, rejecting invalid ones", () => {
    const store = storeWithModel();
    const id = addReliefRoughOperation(store, { modelId: model.id, tool: endMill }) as string;
    expect(
      updateReliefRoughParams(store, id, {
        strategy: { type: "linear", angle: 45 },
        boundary: { type: "margin", distance: 10 },
        stepOver: 25,
        rest: true,
      }),
    ).toEqual({ ok: true });
    expect(updateReliefRoughParams(store, id, { stepOver: 0 })).toMatchObject({ ok: false });
    expect(
      updateReliefRoughParams(store, id, { strategy: { type: "peel", start: "inside" } }),
    ).toMatchObject({ ok: false });
    expect(updateReliefRoughParams(store, id, { stockToLeave: -1 })).toMatchObject({ ok: false });
    expect(store.getState().document.operations[0]?.params).toMatchObject({
      strategy: { type: "linear", angle: 45 },
      boundary: { type: "margin", distance: 10 },
      stepOver: 25,
      stockToLeave: 0.5,
      rest: true,
    });
    expect(store.getState().document.operations[0]?.tool).toEqual(endMill);
  });
});

describe("updatePocketParams", () => {
  const addPocket = (store: ReturnType<typeof setup>["store"]) => {
    const id = addPocketOperation(store, { targets: [whole(square)], tool: endMill });
    if (!id) throw new Error("not added");
    return id;
  };

  it("changes several params as one undo step", () => {
    const { store, operations } = setup();
    const id = addPocket(store);
    const params = () => operations().find((operation) => operation.id === id)?.params;
    expect(updatePocketParams(store, id, { allowance: 0.5, finishPass: true })).toEqual({
      ok: true,
    });
    expect(params()).toMatchObject({ allowance: 0.5, finishPass: true });
    store.getState().undo();
    expect(params()).toMatchObject({ allowance: 0, finishPass: false });
  });

  it("switches the clearing strategy", () => {
    const { store, operations } = setup();
    const id = addPocket(store);
    const strategy = () => operations().find((operation) => operation.id === id)?.params;
    expect(updatePocketParams(store, id, { strategy: { type: "linear", angle: 45 } })).toEqual({
      ok: true,
    });
    expect(strategy()).toMatchObject({ strategy: { type: "linear", angle: 45 } });
    expect(
      updatePocketParams(store, id, {
        strategy: { type: "linear", angle: 30 } as unknown as PocketParams["strategy"],
      }),
    ).toMatchObject({ ok: false });
    expect(strategy()).toMatchObject({ strategy: { type: "linear", angle: 45 } });
  });

  it("rejects invalid params and other operation types", () => {
    const { store, add } = setup();
    const id = addPocket(store);
    expect(updatePocketParams(store, id, { depth: 0 })).toMatchObject({ ok: false });
    expect(updatePocketParams(store, id, { finishPass: true })).toEqual({
      ok: false,
      error: "Needs an allowance to remove",
    });
    expect(updatePocketParams(store, add(), { depth: 3 })).toEqual({
      ok: false,
      error: "Not a pocket operation",
    });
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

describe("tabs", () => {
  function withTabs() {
    const context = setup();
    const id = context.add([whole(square), whole(circle)]);
    const tabs = defaultTabs(context.document(), context.profile(id));
    updateProfileParams(context.store, id, { tabs });
    return { ...context, id };
  }

  it("start 6 mm wide and 3 mm tall, four on each outline", () => {
    const { document, profile, id } = withTabs();
    expect(profile(id).params.tabs).toMatchObject({ width: 6, height: 3 });
    // The square and the circle are side by side: both are outlines.
    expect(profile(id).params.tabs?.positions).toHaveLength(8);
    expect(profile(id).params.tabs?.positions[0]).toEqual([35, 10]);
    expect(ProjectDocument.parse(document())).toEqual(document());
  });

  it("are no taller than half the depth", () => {
    const { store, add, document, profile } = setup();
    const id = add();
    updateProfileParams(store, id, { depth: 4 });
    expect(defaultTabs(document(), profile(id)).height).toBe(2);
  });

  it("auto places by count or spacing, as one undo step", () => {
    const { store, profile, id } = withTabs();
    expect(autoPlaceTabs(store, id, { count: 1 })).toEqual({ ok: true });
    expect(profile(id).params.tabs?.positions).toHaveLength(2);
    // The square is 200 mm round, the circle about 63 mm.
    autoPlaceTabs(store, id, { spacing: 50 });
    expect(profile(id).params.tabs?.positions).toHaveLength(5);
    store.getState().undo();
    expect(profile(id).params.tabs?.positions).toHaveLength(2);
  });

  it("are added, moved and removed one at a time", () => {
    const { store, profile, id } = withTabs();
    autoPlaceTabs(store, id, { count: 1 });
    addTab(store, id, [60, 30]);
    expect(profile(id).params.tabs?.positions.at(-1)).toEqual([60, 30]);
    moveTab(store, id, 2, [60, 40]);
    expect(profile(id).params.tabs?.positions.at(-1)).toEqual([60, 40]);
    removeTab(store, id, 0);
    expect(profile(id).params.tabs?.positions).toHaveLength(2);
    store.getState().undo();
    expect(profile(id).params.tabs?.positions).toHaveLength(3);
  });

  it("does nothing without tabs or out of range", () => {
    const { store, add, profile } = setup();
    const id = add();
    const before = store.getState().document;
    expect(autoPlaceTabs(store, id, { count: 2 })).toMatchObject({ ok: false });
    addTab(store, id, [0, 0]);
    expect(store.getState().document).toBe(before);
    updateProfileParams(store, id, { tabs: { width: 6, height: 3, positions: [] } });
    const withEmpty = store.getState().document;
    moveTab(store, id, 0, [1, 1]);
    removeTab(store, id, 3);
    expect(store.getState().document).toBe(withEmpty);
    expect(profile(id).params.tabs?.positions).toEqual([]);
  });
});

describe("replaceToolSnapshots", () => {
  const edited: Tool = { ...endMill, feedRate: 900, stepDown: 1.5 };

  it("re-snapshots every operation that had the old tool, as one undo step", () => {
    const { store, operations, add, profile } = setup();
    const [a, b] = [add(), add()];
    const other = add();
    setOperationTool(store, other, vBit);
    const drill = addDrillOperation(store, { targets: [whole(circle)], tool: endMill });
    const before = store.getState().past.length;

    expect(replaceToolSnapshots(store, endMill, edited)).toEqual([]);
    expect(operations().map((operation) => operation.tool)).toEqual([edited, edited, vBit, edited]);
    expect(store.getState().past).toHaveLength(before + 1);

    store.getState().undo();
    expect(profile(a).tool).toEqual(endMill);
    expect(profile(b).tool).toEqual(endMill);
    expect(operations().find((operation) => operation.id === drill)?.tool).toEqual(endMill);
  });

  it("keeps the old tool on operations that reject the new one, and says which", () => {
    const { store, operations, add } = setup();
    const id = add();
    const drill = addDrillOperation(store, { targets: [whole(circle)], tool: endMill });
    if (!drill) throw new Error("not added");
    const asVBit: Tool = { ...vBit, name: endMill.name };

    expect(replaceToolSnapshots(store, endMill, asVBit)).toEqual([
      { id: drill, name: "Drill 1", error: "V-bits can't drill" },
    ]);
    expect(operations().find((operation) => operation.id === id)?.tool).toEqual(asVBit);
    expect(operations().find((operation) => operation.id === drill)?.tool).toEqual(endMill);
  });

  it("re-snapshots flat-bottom tools too", () => {
    const { store, operations } = setup();
    const id = addVCarveOperation(store, { targets: [whole(square)], tool: vBit });
    if (!id) throw new Error("not added");
    updateVCarveParams(store, id, { flatBottom: { tool: endMill } });

    expect(replaceToolSnapshots(store, endMill, edited)).toEqual([]);
    expect(operations()[0]).toMatchObject({ tool: vBit, params: { flatBottom: { tool: edited } } });

    const asBall: Tool = { ...edited, type: "ball_end_mill" };
    expect(replaceToolSnapshots(store, edited, asBall)).toEqual([
      { id, name: "V-carve 1", error: "Only flat end mills clear a flat bottom" },
    ]);
    expect(operations()[0]).toMatchObject({ params: { flatBottom: { tool: edited } } });
  });

  it("changes nothing when no operation had the old tool, or the tool is unchanged", () => {
    const { store, add } = setup();
    add();
    const document = store.getState().document;
    const before = store.getState().past.length;
    expect(replaceToolSnapshots(store, vBit, edited)).toEqual([]);
    expect(replaceToolSnapshots(store, endMill, { ...endMill })).toEqual([]);
    expect(store.getState().document).toBe(document);
    expect(store.getState().past).toHaveLength(before);
  });
});
