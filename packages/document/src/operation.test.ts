import { describe, expect, it } from "vitest";
import { CIRCLE_ID, circle, fullDocument, SQUARE_ID, square } from "./fixtures";
import {
  DrillOperation,
  DrillParams,
  normalizeTargets,
  OperationTarget,
  PocketParams,
  ProfileParams,
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
    strategy: { type: "offset" },
    direction: "climb",
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
    expect(PocketParams.safeParse({ ...pocket, stepOver: 40 }).success).toBe(false);
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
  const drill = { ...profile, type: "drill", params: { depth: 10, peck: true } };

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
    expect(DrillParams.safeParse({ depth: 0, peck: false }).success).toBe(false);
    expect(DrillParams.safeParse({ depth: 5, peck: "yes" }).success).toBe(false);
    expect(DrillParams.safeParse({ depth: 5, peck: true, peckDepth: 2 }).success).toBe(false);
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
