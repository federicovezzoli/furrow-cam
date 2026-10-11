import type {
  ProfileOperation,
  ProfileParams,
  ProjectDocument,
  Shape,
  Tool,
} from "@furrow/document";
import { describe, expect, it } from "vitest";
import { DEFAULT_SAFE_Z, generateToolpath, toolpathInput } from "./generate";
import { signedArea } from "./geometry";
import { depthLevels, ENTRY_CLEARANCE, profileToolpath } from "./profile";
import type { Vec3 } from "./stock";
import type { Toolpath, ToolpathMove } from "./toolpath";

const tool: Tool = {
  name: "6 mm upcut",
  type: "flat_end_mill",
  diameter: 6,
  fluteCount: 2,
  fluteLength: 22,
  cutDirection: "upcut",
  vAngle: null,
  tipDiameter: null,
  spindleRpm: 18000,
  feedRate: 1500,
  plungeRate: 500,
  plungeAngle: 3,
  stepDown: 2,
  stepOver: 40,
  notes: null,
  color: "#2563eb",
};

const params: ProfileParams = {
  side: "outside",
  direction: "climb",
  depth: 6,
  allowance: 0,
  finishPass: false,
  leadIn: null,
  ramp: false,
};

/** 100 × 100 mm, counter-clockwise. */
const square: Shape = {
  id: "4f8a1c2e-6b3d-4e5f-9a7b-8c9d0e1f2a3b",
  name: "Square",
  layer: "0",
  paths: [
    {
      start: [0, 0],
      segments: [
        { kind: "line", to: [100, 0] },
        { kind: "line", to: [100, 100] },
        { kind: "line", to: [0, 100] },
      ],
      closed: true,
    },
  ],
};

/** Radius 10 around (50, 50), drawn as its own shape like a DXF circle. */
const hole: Shape = {
  id: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
  name: "Hole",
  layer: "0",
  paths: [
    {
      start: [60, 50],
      segments: [{ kind: "arc", to: [60, 50], center: [50, 50], clockwise: false }],
      closed: true,
    },
  ],
};

const line: Shape = {
  id: "0d9c8b7a-6f5e-4d3c-ab1a-0f9e8d7c6b5a",
  name: "Groove",
  layer: "0",
  paths: [{ start: [10, 10], segments: [{ kind: "line", to: [90, 10] }], closed: false }],
};

function profile(
  overrides: Partial<ProfileParams> = {},
  shapes: Shape[] = [square],
  toolOverrides: Partial<Tool> = {},
): Toolpath {
  const operation: ProfileOperation = {
    id: "11111111-2222-4333-8444-555555555555",
    name: "Profile",
    enabled: true,
    type: "profile",
    shapeIds: shapes.map((shape) => shape.id),
    tool: { ...tool, ...toolOverrides },
    params: { ...params, ...overrides },
  };
  return profileToolpath(operation, shapes, { safeZ: 5 });
}

/** Consecutive moves as `[from, move]`, starting from the first move's target. */
function steps(toolpath: Toolpath): [Vec3, ToolpathMove][] {
  const result: [Vec3, ToolpathMove][] = [];
  let from: Vec3 | null = null;
  for (const move of toolpath.moves) {
    if (from) result.push([from, move]);
    from = move.to;
  }
  return result;
}

/** Feed moves that stay at height `z`, as 2D points. */
function cutsAt(toolpath: Toolpath, z: number): [number, number][] {
  return steps(toolpath)
    .filter(([from, move]) => move.kind === "feed" && from[2] === z && move.to[2] === z)
    .map(([, move]) => [move.to[0], move.to[1]]);
}

function extent(points: [number, number][]) {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/** Angle of a move from horizontal, in degrees. */
function descentAngle(from: Vec3, to: Vec3): number {
  const run = Math.hypot(to[0] - from[0], to[1] - from[1]);
  return (Math.atan2(from[2] - to[2], run) * 180) / Math.PI;
}

describe("depthLevels", () => {
  it("splits the depth into equal passes no deeper than the step-down", () => {
    expect(depthLevels(6, 2)).toEqual([-2, -4, -6]);
    expect(depthLevels(5, 2)).toEqual([-5 / 3, -10 / 3, -5]);
    expect(depthLevels(1, 2)).toEqual([-1]);
    // Float rounding must not add a pass.
    expect(depthLevels(0.3, 0.1)).toHaveLength(3);
  });
});

describe("profileToolpath", () => {
  it("offsets by the tool radius on the chosen side", () => {
    const outside = extent(cutsAt(profile(), -6));
    outside.forEach((value, i) => {
      expect(value).toBeCloseTo([-3, -3, 103, 103][i] as number, 2);
    });
    const inside = extent(cutsAt(profile({ side: "inside" }), -6));
    inside.forEach((value, i) => {
      expect(value).toBeCloseTo([3, 3, 97, 97][i] as number, 2);
    });
    const on = extent(cutsAt(profile({ side: "on" }), -6));
    on.forEach((value, i) => {
      expect(value).toBeCloseTo([0, 0, 100, 100][i] as number, 6);
    });
  });

  it("cuts every depth pass, down to the final depth", () => {
    const toolpath = profile();
    for (const z of [-2, -4, -6]) expect(cutsAt(toolpath, z).length).toBeGreaterThan(3);
    const lowest = Math.min(...toolpath.moves.map((move) => move.to[2]));
    expect(lowest).toBe(-6);
  });

  it("climbs clockwise outside and counter-clockwise inside", () => {
    expect(signedArea(cutsAt(profile(), -2))).toBeLessThan(0);
    expect(signedArea(cutsAt(profile({ direction: "conventional" }), -2))).toBeGreaterThan(0);
    expect(signedArea(cutsAt(profile({ side: "inside" }), -2))).toBeGreaterThan(0);
    const insideConventional = profile({ side: "inside", direction: "conventional" });
    expect(signedArea(cutsAt(insideConventional, -2))).toBeLessThan(0);
  });

  it("rapids only above the stock, and starts and ends at the retract height", () => {
    const toolpath = profile({ ramp: true, leadIn: { radius: 3 } });
    for (const [from, move] of steps(toolpath)) {
      if (move.kind !== "rapid") continue;
      // Down to the entry clearance, or up and across at the retract height.
      if (move.to[2] < from[2]) expect(move.to[2]).toBe(ENTRY_CLEARANCE);
      else expect(move.to[2]).toBe(5);
    }
    // The last millimetre before the stock is fed, not rapid.
    for (const [from, move] of steps(toolpath)) {
      if (from[2] === ENTRY_CLEARANCE) expect(move).toMatchObject({ kind: "feed", feedRate: 500 });
    }
    expect(toolpath.moves[0]).toMatchObject({ kind: "rapid" });
    expect(toolpath.moves.at(-1)).toMatchObject({ kind: "rapid" });
  });

  it("plunges straight down at the plunge rate without a ramp", () => {
    for (const [from, move] of steps(profile())) {
      if (move.kind === "feed" && move.to[2] < from[2]) {
        expect(move.to.slice(0, 2)).toEqual(from.slice(0, 2));
        expect(move.feedRate).toBe(tool.plungeRate);
      }
      if (move.kind === "feed" && move.to[2] === from[2]) expect(move.feedRate).toBe(tool.feedRate);
    }
  });

  it("ramps no steeper than the plunge angle", () => {
    for (const leadIn of [null, { radius: 3 }]) {
      const toolpath = profile({ ramp: true, leadIn });
      let ramps = 0;
      for (const [from, move] of steps(toolpath)) {
        // Entering from the retract height to the stock top is through air.
        if (move.kind !== "feed" || move.to[2] >= from[2] || from[2] > 0) continue;
        ramps++;
        expect(descentAngle(from, move.to)).toBeLessThanOrEqual(3 + 1e-6);
        expect(move.feedRate).toBe(tool.plungeRate);
      }
      expect(ramps).toBeGreaterThan(3);
    }
  });

  it("ramps back and forth only as far as it needs on an open path", () => {
    const toolpath = profile({ side: "on", ramp: true }, [line]);
    const ramp = steps(toolpath).filter(
      ([from, move]) => move.to[2] < from[2] && from[2] <= 0 && from[2] > -2,
    );
    // 2 mm at 3° is about 38 mm of travel: 19 mm along the 80 mm groove and back.
    const xs = ramp.map(([, move]) => move.to[0]);
    expect(Math.max(...xs)).toBeCloseTo(10 + 1 / Math.tan((3 * Math.PI) / 180), 6);
    expect(ramp.at(-1)?.[1].to).toEqual([10, 10, -2]);
  });

  it("plunges when the tool's plunge angle is 90°", () => {
    for (const [from, move] of steps(profile({ ramp: true }, [square], { plungeAngle: 90 }))) {
      if (move.to[2] < from[2]) expect(move.to.slice(0, 2)).toEqual(from.slice(0, 2));
    }
  });

  it("leads in on the waste side, tangent to the contour", () => {
    for (const side of ["outside", "inside"] as const) {
      const toolpath = profile({ side, leadIn: { radius: 3 } });
      const entry = toolpath.moves[0]?.to as Vec3;
      // The entry point is 3 mm further into the waste than the contour.
      const [x, y] = entry;
      const wall = Math.min(Math.abs(x), Math.abs(100 - x), Math.abs(y), Math.abs(100 - y));
      const inSquare = x > 0 && x < 100 && y > 0 && y < 100;
      if (side === "outside") {
        expect(inSquare).toBe(false);
        expect(wall).toBeCloseTo(6, 2);
      } else {
        expect(inSquare).toBe(true);
        expect(wall).toBeCloseTo(6, 2);
      }
    }
  });

  it("leaves the allowance on the depth passes and finishes the exact contour", () => {
    const toolpath = profile({ allowance: 0.5, finishPass: true });
    // The finish lap goes straight down to full depth through the slot the passes cleared.
    const finish = steps(toolpath).findLastIndex(
      ([from, move]) => from[2] === 0 && move.to[2] === -6 && move.to[0] === from[0],
    );
    expect(finish).toBeGreaterThan(0);
    const xs = (moves: ToolpathMove[]) => Math.min(...moves.map((move) => move.to[0]));
    expect(xs(toolpath.moves.slice(0, finish + 1))).toBeCloseTo(-3.5, 2);
    expect(xs(toolpath.moves.slice(finish + 2, -1))).toBeCloseTo(-3, 2);
    expect(toolpath.moves.slice(finish + 2, -1).every((move) => move.to[2] === -6)).toBe(true);
  });

  it("cuts holes before the outline that frees the part", () => {
    const laps = cutsAt(profile({}, [square, hole]), -2);
    const inHole = laps.map(([x, y]) => Math.hypot(x - 50, y - 50) < 7 + 0.01);
    const holeLap = laps.filter((_, i) => inHole[i]);
    expect(holeLap.length).toBeGreaterThan(10);
    expect(inHole.lastIndexOf(true)).toBeLessThan(inHole.indexOf(false));
    // Climb inside the hole runs counter-clockwise, keeping the part on the right.
    expect(signedArea(holeLap)).toBeGreaterThan(0);
  });

  it("follows open paths on the line, alternating direction per pass", () => {
    const toolpath = profile({ side: "on" }, [line]);
    expect(toolpath.warnings).toEqual([]);
    const ends = [-2, -4, -6].map((z) => cutsAt(toolpath, z).at(-1)?.[0]);
    expect(ends).toEqual([90, 10, 90]);
  });

  it("warns about what it can't cut", () => {
    const point: Shape = { ...line, paths: [{ start: [5, 5], segments: [], closed: false }] };
    expect(profile({}, [line, point]).warnings).toEqual([
      "Skipped 1 point: drill them instead.",
      "Skipped 1 open path: inside and outside profiles need closed paths.",
    ]);
    expect(profile({ side: "inside" }, [square], { diameter: 120 }).warnings).toEqual([
      "The closed paths are too small for the tool.",
    ]);
    expect(profile({ depth: 30 }).warnings).toEqual(["The depth exceeds the tool's flute length."]);
  });
});

describe("generateToolpath", () => {
  const doc = (machineSafeZ: number | null): ProjectDocument => ({
    schemaVersion: 1,
    units: "mm",
    stock: {
      width: 200,
      height: 200,
      thickness: 18,
      xyOrigin: "bottom_left",
      zOrigin: "stock_top",
    },
    machine:
      machineSafeZ === null
        ? null
        : {
            name: "Router",
            workAreaX: 400,
            workAreaY: 400,
            workAreaZ: 80,
            maxFeedXY: 5000,
            maxFeedZ: 1000,
            spindleRpmMin: null,
            spindleRpmMax: null,
            safeZ: machineSafeZ,
            postProcessor: "grbl",
            programStart: null,
            programEnd: null,
            operationStart: null,
            toolChange: null,
          },
    geometry: [square, hole],
    operations: [
      {
        id: "11111111-2222-4333-8444-555555555555",
        name: "Profile",
        enabled: true,
        type: "profile",
        shapeIds: [hole.id],
        tool,
        params,
      },
    ],
  });

  it("collects the operation's shapes and retract height", () => {
    const input = toolpathInput(doc(12), "11111111-2222-4333-8444-555555555555");
    expect(input.shapes).toEqual([hole]);
    expect(input.safeZ).toBe(12);
    expect(toolpathInput(doc(null), "11111111-2222-4333-8444-555555555555").safeZ).toBe(
      DEFAULT_SAFE_Z,
    );
    expect(generateToolpath(input).moves[0]?.to[2]).toBe(12);
  });

  it("rejects unknown operations", () => {
    expect(() => toolpathInput(doc(null), "nope")).toThrow();
  });
});
