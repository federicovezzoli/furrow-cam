import { describe, expect, it } from "vitest";
import { ProjectDocument } from "./document";
import {
  CIRCLE_ID,
  circle,
  drill,
  endMill,
  fullDocument,
  reliefFinish,
  reliefRough,
  SQUARE_ID,
  square,
  vBit,
} from "./fixtures";
import {
  clearingTool,
  DrillOperation,
  DrillParams,
  EngraveOperation,
  EngraveParams,
  normalizeTargets,
  Operation,
  OperationTarget,
  operationModelId,
  PocketParams,
  ProfileParams,
  ReliefFinishOperation,
  ReliefFinishParams,
  ReliefRoughOperation,
  ReliefRoughParams,
  toolProblem,
  VCarveOperation,
  VCarveParams,
} from "./operation";

const params = fullDocument().operations[0]?.params as ProfileParams;

describe("ProfileParams", () => {
  it("accepts the fixture", () => {
    expect(ProfileParams.parse(params)).toEqual(params);
    expect(
      ProfileParams.safeParse({ ...params, leadIn: null, ramp: false, tabs: null }).success,
    ).toBe(true);
  });

  it("rejects out-of-range values", () => {
    expect(ProfileParams.safeParse({ ...params, depth: 0 }).success).toBe(false);
    expect(ProfileParams.safeParse({ ...params, allowance: -0.1 }).success).toBe(false);
    expect(ProfileParams.safeParse({ ...params, leadIn: { radius: 0 } }).success).toBe(false);
    expect(ProfileParams.safeParse({ ...params, side: "left" }).success).toBe(false);
  });

  it("rejects tabs without a width or height, or with malformed positions", () => {
    const tabs = { width: 8, height: 3, positions: [[50, 0]] };
    expect(ProfileParams.safeParse({ ...params, tabs: { ...tabs, positions: [] } }).success).toBe(
      true,
    );
    expect(ProfileParams.safeParse({ ...params, tabs: { ...tabs, width: 0 } }).success).toBe(false);
    expect(ProfileParams.safeParse({ ...params, tabs: { ...tabs, height: -1 } }).success).toBe(
      false,
    );
    expect(
      ProfileParams.safeParse({ ...params, tabs: { ...tabs, positions: [[50]] } }).success,
    ).toBe(false);
    expect(ProfileParams.safeParse({ ...params, tabs: { ...tabs, count: 4 } }).success).toBe(false);
  });

  it("allows no allowance on the line", () => {
    const onLine = { ...params, side: "on", allowance: 0, finishPass: false };
    expect(ProfileParams.safeParse(onLine).success).toBe(true);
    expect(ProfileParams.safeParse({ ...onLine, allowance: 0.5 }).success).toBe(false);
  });

  it("needs an allowance for a finish pass", () => {
    expect(ProfileParams.safeParse({ ...params, allowance: 0 }).success).toBe(false);
    expect(ProfileParams.safeParse({ ...params, allowance: 0, finishPass: false }).success).toBe(
      true,
    );
  });
});

describe("PocketParams", () => {
  const pocket: PocketParams = {
    side: "inside",
    strategy: { type: "offset" },
    direction: "climb",
    stepOver: 40,
    depth: 6,
    allowance: 0.3,
    finishPass: true,
    ramp: true,
  };

  it("accepts valid params", () => {
    expect(PocketParams.parse(pocket)).toEqual(pocket);
    expect(PocketParams.safeParse({ ...pocket, allowance: 0, finishPass: false }).success).toBe(
      true,
    );
  });

  it("rejects invalid values and unknown keys", () => {
    expect(PocketParams.safeParse({ ...pocket, depth: 0 }).success).toBe(false);
    expect(PocketParams.safeParse({ ...pocket, allowance: -0.1 }).success).toBe(false);
    expect(PocketParams.safeParse({ ...pocket, direction: "up" }).success).toBe(false);
    expect(PocketParams.safeParse({ ...pocket, stepOver: 0 }).success).toBe(false);
    expect(PocketParams.safeParse({ ...pocket, stepOver: 101 }).success).toBe(false);
    expect(PocketParams.safeParse({ ...pocket, feed: 1000 }).success).toBe(false);
  });

  it("needs an allowance for a finish pass", () => {
    expect(PocketParams.safeParse({ ...pocket, allowance: 0 }).success).toBe(false);
  });

  it("accepts the clearing strategies and their presets", () => {
    for (const angle of [0, 90, 45, -45]) {
      const strategy = { type: "linear", angle };
      expect(PocketParams.parse({ ...pocket, strategy }).strategy).toEqual(strategy);
    }
    for (const start of ["centre", "inside", "outside"]) {
      const strategy = { type: "peel", start };
      expect(PocketParams.parse({ ...pocket, strategy }).strategy).toEqual(strategy);
    }
  });

  it("rejects free angles, unknown strategies and missing parameters", () => {
    for (const strategy of [
      { type: "linear", angle: 30 },
      { type: "linear" },
      { type: "peel", start: "middle" },
      { type: "peel" },
      { type: "offset", angle: 0 },
      { type: "spiral" },
    ]) {
      expect(PocketParams.safeParse({ ...pocket, strategy }).success).toBe(false);
    }
    const { strategy: _, ...withoutStrategy } = pocket;
    expect(PocketParams.safeParse(withoutStrategy).success).toBe(false);
  });
});

describe("DrillOperation", () => {
  const profile = fullDocument().operations[0];
  if (!profile) throw new Error("The fixture has an operation");
  const drill = {
    ...profile,
    type: "drill",
    params: { depth: 10, peck: true, stepOver: 40, pins: false },
  };

  it("accepts drills and end mills", () => {
    expect(DrillOperation.safeParse(drill).success).toBe(true);
    const drillBit = { ...drill.tool, type: "drill", cutDirection: null, plungeAngle: 90 };
    expect(DrillOperation.safeParse({ ...drill, tool: drillBit }).success).toBe(true);
  });

  it("rejects V-bits", () => {
    const vBit = { ...drill.tool, type: "v_bit", cutDirection: null, vAngle: 60, tipDiameter: 0 };
    expect(DrillOperation.safeParse({ ...drill, tool: vBit }).success).toBe(false);
  });

  it("rejects invalid params and unknown keys", () => {
    expect(DrillParams.safeParse({ depth: 0, peck: false, stepOver: 40 }).success).toBe(false);
    expect(DrillParams.safeParse({ depth: 5, peck: "yes", stepOver: 40 }).success).toBe(false);
    expect(DrillParams.safeParse({ depth: 5, peck: true, stepOver: 0 }).success).toBe(false);
    expect(DrillParams.safeParse({ depth: 5, peck: true }).success).toBe(false);
    expect(
      DrillParams.safeParse({ depth: 5, peck: true, stepOver: 40, peckDepth: 2 }).success,
    ).toBe(false);
  });
});

describe("EngraveOperation", () => {
  const profile = fullDocument().operations[0];
  if (!profile) throw new Error("The fixture has an operation");
  const engrave = { ...profile, type: "engrave", params: { side: "on", depth: 0.5, ramp: false } };
  const vBit = { ...profile.tool, type: "v_bit", cutDirection: null, vAngle: 60, tipDiameter: 0 };

  it("accepts V-bits, ball and flat end mills, as an operation too", () => {
    expect(EngraveOperation.safeParse(engrave).success).toBe(true);
    expect(EngraveOperation.safeParse({ ...engrave, tool: vBit }).success).toBe(true);
    const ball = { ...profile.tool, type: "ball_end_mill" };
    expect(EngraveOperation.safeParse({ ...engrave, tool: ball }).success).toBe(true);
    expect(Operation.parse(engrave)).toEqual(engrave);
  });

  it("rejects drill bits", () => {
    const drillBit = { ...profile.tool, type: "drill", cutDirection: null, plungeAngle: 90 };
    expect(EngraveOperation.safeParse({ ...engrave, tool: drillBit }).success).toBe(false);
  });

  it("rejects invalid params and the profile's options", () => {
    const valid = { side: "outside", depth: 1, ramp: false };
    expect(EngraveParams.safeParse(valid).success).toBe(true);
    expect(EngraveParams.safeParse({ ...valid, depth: 0 }).success).toBe(false);
    expect(EngraveParams.safeParse({ ...valid, side: "left" }).success).toBe(false);
    expect(EngraveParams.safeParse({ depth: 1, ramp: false }).success).toBe(false);
    for (const extra of [{ allowance: 0 }, { tabs: null }, { leadIn: null }]) {
      expect(EngraveParams.safeParse({ ...valid, ...extra }).success).toBe(false);
    }
  });
});

describe("VCarveOperation", () => {
  const profile = fullDocument().operations[0];
  if (!profile) throw new Error("The fixture has an operation");
  const endMill = profile.tool;
  const vBit = { ...endMill, type: "v_bit", cutDirection: null, vAngle: 60, tipDiameter: 0 };
  const vcarve = {
    ...profile,
    type: "vcarve",
    tool: vBit,
    params: { maxDepth: 5, flatBottom: null },
  };

  it("accepts V-bits, with or without a flat bottom, as an operation too", () => {
    expect(VCarveOperation.safeParse(vcarve).success).toBe(true);
    const flat = {
      ...vcarve,
      params: { maxDepth: 3, flatBottom: { tool: endMill, stepOver: 40 } },
    };
    expect(Operation.parse(flat)).toEqual(flat);
    expect(Operation.parse(vcarve)).toEqual(vcarve);
  });

  it("rejects other tools", () => {
    expect(VCarveOperation.safeParse({ ...vcarve, tool: endMill }).success).toBe(false);
    const ball = { ...endMill, type: "ball_end_mill" };
    expect(VCarveOperation.safeParse({ ...vcarve, tool: ball }).success).toBe(false);
  });

  it("clears a flat bottom with flat end mills only", () => {
    for (const tool of [vBit, { ...endMill, type: "ball_end_mill" }]) {
      const params = { maxDepth: 3, flatBottom: { tool, stepOver: 40 } };
      expect(VCarveOperation.safeParse({ ...vcarve, params }).success).toBe(false);
    }
  });

  it("rejects invalid params and unknown keys", () => {
    expect(VCarveParams.safeParse({ maxDepth: 0, flatBottom: null }).success).toBe(false);
    expect(VCarveParams.safeParse({ flatBottom: null }).success).toBe(false);
    expect(VCarveParams.safeParse({ maxDepth: 2 }).success).toBe(false);
    expect(VCarveParams.safeParse({ maxDepth: 2, flatBottom: {} }).success).toBe(false);
    expect(VCarveParams.safeParse({ maxDepth: 2, flatBottom: null, depth: 1 }).success).toBe(false);
  });

  it("names the flat-bottom tool as the clearing tool", () => {
    expect(clearingTool(VCarveOperation.parse(vcarve))).toBeNull();
    const params = { maxDepth: 3, flatBottom: { tool: endMill, stepOver: 40 } };
    expect(clearingTool(VCarveOperation.parse({ ...vcarve, params }))).toEqual(endMill);
    expect(clearingTool(profile)).toBeNull();
  });
});

describe("OperationTarget", () => {
  const shapeId = "4f8a1c2e-6b3d-4e5f-9a7b-8c9d0e1f2a3b";

  it("accepts whole shapes and ascending path indices", () => {
    expect(OperationTarget.safeParse({ shapeId, paths: null }).success).toBe(true);
    expect(OperationTarget.safeParse({ shapeId, paths: [0, 2, 7] }).success).toBe(true);
  });

  it("rejects empty, unordered, repeated or negative indices", () => {
    for (const paths of [[], [2, 1], [1, 1], [-1], [1.5]]) {
      expect(OperationTarget.safeParse({ shapeId, paths }).success).toBe(false);
    }
    expect(OperationTarget.safeParse({ shapeId }).success).toBe(false);
  });
});

describe("normalizeTargets", () => {
  const point = (x: number) => ({ start: [x, 0] as [number, number], segments: [], closed: false });
  const three = { ...square, paths: [point(0), point(1), point(2)] };
  const geometry = [three, circle];
  const missing = "11111111-2222-4333-8444-555555555555";

  it("puts targets in document order, one per shape, paths ascending", () => {
    expect(
      normalizeTargets(geometry, [
        { shapeId: CIRCLE_ID, paths: null },
        { shapeId: SQUARE_ID, paths: [2] },
        { shapeId: SQUARE_ID, paths: [0] },
      ]),
    ).toEqual([
      { shapeId: SQUARE_ID, paths: [0, 2] },
      { shapeId: CIRCLE_ID, paths: null },
    ]);
  });

  it("makes a target whole once all its shape's paths are in it", () => {
    expect(normalizeTargets(geometry, [{ shapeId: SQUARE_ID, paths: [2, 1, 0] }])).toEqual([
      { shapeId: SQUARE_ID, paths: null },
    ]);
    expect(normalizeTargets(geometry, [{ shapeId: CIRCLE_ID, paths: [0] }])).toEqual([
      { shapeId: CIRCLE_ID, paths: null },
    ]);
    expect(
      normalizeTargets(geometry, [
        { shapeId: SQUARE_ID, paths: [1] },
        { shapeId: SQUARE_ID, paths: null },
      ]),
    ).toEqual([{ shapeId: SQUARE_ID, paths: null }]);
  });

  it("skips shapes and paths that aren't there", () => {
    expect(
      normalizeTargets(geometry, [
        { shapeId: missing, paths: null },
        { shapeId: SQUARE_ID, paths: [7] },
        { shapeId: CIRCLE_ID, paths: [0, 4] },
      ]),
    ).toEqual([{ shapeId: CIRCLE_ID, paths: null }]);
  });
});

describe("ReliefFinishOperation", () => {
  it("accepts the fixture with every tool shape", () => {
    expect(Operation.parse(reliefFinish)).toEqual(reliefFinish);
    for (const tool of [endMill, vBit, drill]) {
      expect(ReliefFinishOperation.safeParse({ ...reliefFinish, tool }).success).toBe(true);
    }
  });

  it("rejects out-of-range params", () => {
    const { params } = reliefFinish;
    const parallel = { type: "parallel", angle: 0, direction: "zigzag" };
    for (const changes of [
      { strategy: { ...parallel, angle: -1 } },
      { strategy: { ...parallel, angle: 180 } },
      { strategy: { ...parallel, direction: "spiral" } },
      { strategy: { type: "parallel", angle: 0 } },
      { strategy: { type: "waterline", stepDown: 0 } },
      { strategy: { type: "waterline", stepDown: 1, angle: 0 } },
      { strategy: { type: "spiral", start: "inside" } },
      { strategy: { type: "contour" } },
      { angle: 0 },
      { stepOver: 0 },
      { stepOver: 101 },
      { stockToLeave: -0.1 },
      { modelId: "emblem" },
    ]) {
      expect(ReliefFinishParams.safeParse({ ...params, ...changes }).success).toBe(false);
    }
    for (const strategy of [
      { ...parallel, angle: 179.5, direction: "one_way" },
      { type: "waterline", stepDown: 0.5 },
      { type: "spiral", start: "outside" },
      { type: "spiral", start: "centre" },
    ]) {
      expect(ReliefFinishParams.safeParse({ ...params, strategy }).success).toBe(true);
    }
  });

  it("machines a model, not shapes", () => {
    const targets = [{ shapeId: SQUARE_ID, paths: null }];
    expect(ReliefFinishOperation.safeParse({ ...reliefFinish, targets }).error?.issues).toEqual([
      expect.objectContaining({ path: ["targets"] }),
    ]);
  });

  it("names the model it machines", () => {
    expect(operationModelId(reliefFinish)).toBe(reliefFinish.params.modelId);
    expect(operationModelId(reliefRough)).toBe(reliefRough.params.modelId);
    expect(operationModelId(fullDocument().operations[0] as Operation)).toBeNull();
  });
});

describe("ReliefRoughOperation", () => {
  it("accepts the fixture with every strategy and boundary", () => {
    expect(Operation.parse(reliefRough)).toEqual(reliefRough);
    const { params } = reliefRough;
    for (const changes of [
      { strategy: { type: "linear", angle: 45 } },
      { strategy: { type: "peel", start: "centre" } },
      { strategy: { type: "peel", start: "outside" } },
      { boundary: { type: "stock" } },
      { boundary: { type: "margin", distance: 10 } },
      { stepOver: 25 },
      { direction: "conventional", ramp: false, stockToLeave: 0 },
    ]) {
      expect(ReliefRoughParams.safeParse({ ...params, ...changes }).success).toBe(true);
    }
  });

  it("rejects out-of-range params", () => {
    const { params } = reliefRough;
    for (const changes of [
      { stockToLeave: -0.1 },
      { stepOver: 0 },
      { stepOver: 101 },
      { boundary: { type: "drawing" } },
      { boundary: "model" },
      { boundary: { type: "margin", distance: 0 } },
      { boundary: { type: "margin" } },
      { boundary: { type: "model", distance: 10 } },
      { strategy: { type: "linear", angle: 30 } },
      { modelId: "emblem" },
    ]) {
      expect(ReliefRoughParams.safeParse({ ...params, ...changes }).success).toBe(false);
    }
  });

  it("doesn't peel from an island, which changes from level to level", () => {
    const strategy = { type: "peel", start: "inside" };
    expect(ReliefRoughParams.safeParse({ ...reliefRough.params, strategy }).error?.issues).toEqual([
      expect.objectContaining({ path: ["strategy", "start"] }),
    ]);
  });

  it("machines a model, not shapes", () => {
    const targets = [{ shapeId: SQUARE_ID, paths: null }];
    expect(ReliefRoughOperation.safeParse({ ...reliefRough, targets }).error?.issues).toEqual([
      expect.objectContaining({ path: ["targets"] }),
    ]);
  });
});

describe("toolProblem", () => {
  const document = fullDocument();
  const profile = document.operations[0] as Operation;
  const pocket = { ...profile, type: "pocket" } as Operation;

  it("refuses drill bits on operations that cut sideways", () => {
    for (const operation of [profile, pocket, reliefRough, reliefFinish]) {
      expect(toolProblem({ ...operation, tool: drill } as Operation)).toEqual({
        code: "operation.drillsCantCutSideways",
      });
      expect(toolProblem({ ...operation, tool: endMill } as Operation)).toBeNull();
      expect(toolProblem({ ...operation, tool: vBit } as Operation)).toBeNull();
    }
  });

  it("leaves drilling to drill bits", () => {
    const drilling = { ...profile, type: "drill", tool: drill, params: { depth: 5, peck: false } };
    expect(toolProblem(drilling as Operation)).toBeNull();
  });

  it("still lets a project saved with a drill bit on a profile open", () => {
    const saved = { ...document, operations: [{ ...profile, tool: drill }] };
    expect(ProjectDocument.safeParse(saved).success).toBe(true);
  });
});
