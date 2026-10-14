import {
  DEFAULT_ENTRY_CLEARANCE,
  type ProfileOperation,
  type ProfileParams,
  type ProjectDocument,
  type Shape,
  type Tool,
} from "@furrow/document";
import { describe, expect, it } from "vitest";
import { DEFAULT_SAFE_Z, generateToolpath, toolpathInput } from "./generate";
import { signedArea } from "./geometry";
import { depthLevels } from "./passes";
import { profileToolpath } from "./profile";
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
  tabs: null,
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
    targets: shapes.map((shape) => ({ shapeId: shape.id, paths: null })),
    tool: { ...tool, ...toolOverrides },
    params: { ...params, ...overrides },
  };
  return profileToolpath(operation, shapes, { safeZ: 5, entryClearance: 1 });
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
      if (move.to[2] < from[2]) expect(move.to[2]).toBe(1);
      else expect(move.to[2]).toBe(5);
    }
    // The last millimetre before the stock is fed, not rapid.
    for (const [from, move] of steps(toolpath)) {
      if (from[2] === 1) expect(move).toMatchObject({ kind: "feed", feedRate: 500 });
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

  it("finishes each contour right after its depth passes", () => {
    const toolpath = profile({ allowance: 0.5, finishPass: true }, [square, hole]);
    // Laps at full depth: hole roughing (r 6.5), hole finish (r 7), then the outline's.
    const radii = cutsAt(toolpath, -6).map(([x, y]) => Math.hypot(x - 50, y - 50));
    const firstOutline = radii.findIndex((r) => r > 10);
    const holeLaps = radii.slice(0, firstOutline);
    expect(Math.min(...holeLaps)).toBeCloseTo(6.5, 1);
    expect(Math.max(...holeLaps)).toBeCloseTo(7, 1);
    expect(radii.slice(firstOutline).every((r) => r > 10)).toBe(true);
  });

  it("shortens a lead-in that doesn't fit, or leaves it out", () => {
    // A 20 mm hole leaves 7 mm for the tool centre: a 10 mm arc would cross it.
    const small: Shape = {
      ...hole,
      paths: [
        {
          start: [60, 50],
          segments: [{ kind: "arc", to: [60, 50], center: [50, 50], clockwise: true }],
          closed: true,
        },
      ],
    };
    const toolpath = profile({ side: "inside", leadIn: { radius: 10 } }, [small]);
    for (const move of toolpath.moves) {
      expect(Math.hypot(move.to[0] - 50, move.to[1] - 50)).toBeLessThanOrEqual(7 + 0.01);
    }
    expect(toolpath.warnings).toEqual([
      "The lead-in didn't fit 1 contour and was shortened or left out.",
    ]);
    // Outside a lone square there is room for any lead-in.
    expect(profile({ leadIn: { radius: 10 } }).warnings).toEqual([]);
  });

  it("cuts open paths before closed contours", () => {
    const toolpath = profile({ side: "on" }, [square, line]);
    const first = cutsAt(toolpath, -2)[0];
    expect(first?.[1]).toBe(10);
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

describe("profileToolpath with tabs", () => {
  /** 4 mm wide, 3 mm tall: over a 6 mm tool the centre stays up for 10 mm. */
  const tabs = (positions: [number, number][]) => ({ width: 4, height: 3, positions });
  const midSides: [number, number][] = [
    [50, 0],
    [100, 50],
    [50, 100],
    [0, 50],
  ];
  /** The tabs' centres on the outside contour, 3 mm out. */
  const centres: [number, number][] = [
    [50, -3],
    [103, 50],
    [50, 103],
    [-3, 50],
  ];

  /** Points along the feed moves that are below `top` within `half` of one of `at`. */
  function intrusions(toolpath: Toolpath, top: number, half = 5, at = centres): Vec3[] {
    const found: Vec3[] = [];
    for (const [from, move] of steps(toolpath)) {
      if (move.kind !== "feed") continue;
      for (let i = 0; i <= 20; i++) {
        const f = i / 20;
        const p = from.map((v, k) => v + ((move.to[k] as number) - v) * f) as Vec3;
        if (p[2] >= top - 1e-6) continue;
        if (at.some(([x, y]) => Math.hypot(p[0] - x, p[1] - y) < half - 1e-6)) found.push(p);
      }
    }
    return found;
  }

  it("keeps the tool at the tab top over each tab on the passes below it", () => {
    const toolpath = profile({ tabs: tabs([[50, 0]]) });
    expect(intrusions(toolpath, -3, 5, [[50, -3]])).toEqual([]);
    // Across the tab at its top on the -4 and -6 passes, untouched on the -2 pass.
    const across = cutsAt(toolpath, -3);
    expect(across.length).toBeGreaterThan(1);
    for (const [x, y] of across) {
      expect(y).toBeCloseTo(-3, 6);
      expect(Math.abs(x - 50)).toBeLessThanOrEqual(5 + 1e-6);
    }
    expect(cutsAt(toolpath, -2).some(([x, y]) => Math.abs(x - 45) < 1e-6 && y === -3)).toBe(true);
    // Everywhere else the contour is still cut to full depth.
    expect(cutsAt(toolpath, -6).length).toBeGreaterThan(3);
    expect(toolpath.warnings).toEqual([]);
  });

  it("goes straight up and down at the tab's edges", () => {
    const toolpath = profile({ tabs: tabs([[50, 0]]) });
    const vertical = steps(toolpath).filter(
      ([from, move]) => move.kind === "feed" && from[2] < 0 && move.to[2] !== from[2],
    );
    const ups = vertical.filter(([from, move]) => move.to[2] > from[2]);
    expect(ups).toHaveLength(2);
    for (const [from, move] of vertical) expect(move.to.slice(0, 2)).toEqual(from.slice(0, 2));
    for (const [, move] of ups) expect(move).toMatchObject({ feedRate: tool.feedRate });
  });

  it("never starts a contour on a tab", () => {
    for (const leadIn of [null, { radius: 3 }]) {
      const toolpath = profile({ tabs: tabs(midSides), leadIn });
      expect(intrusions(toolpath, -3)).toEqual([]);
      const start = toolpath.moves.find((move) => move.to[2] === 0)?.to as Vec3;
      for (const [x, y] of centres)
        expect(Math.hypot(start[0] - x, start[1] - y)).toBeGreaterThan(5);
    }
  });

  it("rises over tabs while ramping and on the finish pass", () => {
    const ramped = profile({ ramp: true, tabs: tabs(midSides) });
    expect(intrusions(ramped, -3)).toEqual([]);
    const finished = profile({ allowance: 0.5, finishPass: true, tabs: tabs(midSides) });
    expect(intrusions(finished, -3)).toEqual([]);
    // The finish lap still cuts the exact contour away from the tabs.
    expect(cutsAt(finished, -6).some(([x, y]) => Math.abs(y + 3) < 1e-6 && x > 60)).toBe(true);
  });

  it("restarts a contour mid-edge between equally spaced tabs, keeping the lead-in finite", () => {
    const toolpath = profile({ tabs: tabs(midSides), leadIn: { radius: 3 } });
    for (const move of toolpath.moves) expect(move.to.every(Number.isFinite)).toBe(true);
    // The lead-in arc ends on a straight side of the contour, not on a rounded corner.
    const onContour = ([x, y]: Vec3) =>
      Math.abs(Math.max(Math.abs(x - 50), Math.abs(y - 50)) - 53) < 1e-6;
    const arcEnd = toolpath.moves.find((move) => move.to[2] === -2 && onContour(move.to))?.to;
    const [x, y] = arcEnd as Vec3;
    const alongBottomOrTop =
      (Math.abs(y + 3) < 1e-6 || Math.abs(y - 103) < 1e-6) && x > 0 && x < 100;
    const alongSides = (Math.abs(x + 3) < 1e-6 || Math.abs(x - 103) < 1e-6) && y > 0 && y < 100;
    expect(alongBottomOrTop || alongSides).toBe(true);
  });

  it("ramps back down after each tab when ramping", () => {
    const top = -3;
    const descents = (toolpath: Toolpath) =>
      steps(toolpath).filter(
        ([from, move]) => move.kind === "feed" && from[2] === top && move.to[2] < top,
      );
    const ramped = profile({ ramp: true, tabs: tabs(midSides) });
    expect(descents(ramped).length).toBeGreaterThan(0);
    for (const [from, move] of descents(ramped)) {
      expect(descentAngle(from, move.to)).toBeLessThanOrEqual(3 + 1e-6);
    }
    expect(intrusions(ramped, top)).toEqual([]);
    // Without a ramp it drops straight down.
    for (const [from, move] of descents(profile({ tabs: tabs(midSides) }))) {
      expect(move.to.slice(0, 2)).toEqual(from.slice(0, 2));
    }
  });

  it("puts each tab on the nearest contour", () => {
    const toolpath = profile({ tabs: tabs([[50, 40]]) }, [square, hole]);
    // The hole's contour (r 7) is nearer than the outline's.
    const lifted = cutsAt(toolpath, -3).filter(([x, y]) => Math.hypot(x - 50, y - 50) < 7.01);
    expect(lifted.length).toBeGreaterThan(0);
    expect(cutsAt(toolpath, -3).every(([x, y]) => Math.hypot(x - 50, y - 50) < 7.01)).toBe(true);
  });

  it("warns about tabs it can't place or that leave nothing to cut", () => {
    expect(
      profile({
        tabs: tabs([
          [50, 0],
          [500, 500],
        ]),
      }).warnings,
    ).toEqual(["Left out 1 tab too far from every closed contour."]);
    // Near enough to the depth passes (3.5 mm out) but not to the finish lap (3 mm out).
    const finishing = profile({ allowance: 0.5, finishPass: true, tabs: tabs([[50, -10.5]]) });
    expect(finishing.warnings).toEqual(["Left out 1 tab too far from every closed contour."]);
    const tall = profile({ tabs: { width: 4, height: 6, positions: [[50, 0]] } });
    expect(tall.warnings).toEqual([
      "The tabs are as tall as the cut is deep, so nothing is cut under them.",
    ]);
    expect(Math.max(...tall.moves.filter((m) => m.kind === "feed").map((m) => m.to[2]))).toBe(0);
  });

  it("cuts all the way round without positions", () => {
    expect(profile({ tabs: tabs([]) })).toEqual(profile());
  });
});

describe("generateToolpath", () => {
  const doc = (machineSafeZ: number | null, entryClearance = 1): ProjectDocument => ({
    schemaVersion: 4,
    units: "mm",
    stock: {
      width: 200,
      height: 200,
      thickness: 18,
      xyOrigin: { anchor: "bottom_left" },
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
            entryClearance,
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
        targets: [{ shapeId: hole.id, paths: null }],
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

  it("collects the machine's entry clearance, or the default without a machine", () => {
    const input = toolpathInput(doc(12, 3), "11111111-2222-4333-8444-555555555555");
    expect(input.entryClearance).toBe(3);
    expect(generateToolpath(input).moves[1]?.to[2]).toBe(3);
    expect(toolpathInput(doc(null), "11111111-2222-4333-8444-555555555555").entryClearance).toBe(
      DEFAULT_ENTRY_CLEARANCE,
    );
  });

  it("rejects unknown operations", () => {
    expect(() => toolpathInput(doc(null), "nope")).toThrow();
  });
});
