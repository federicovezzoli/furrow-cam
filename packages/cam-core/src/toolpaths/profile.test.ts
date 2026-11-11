import {
  CURRENT_SCHEMA_VERSION,
  DEFAULT_ENTRY_CLEARANCE,
  type ProfileOperation,
  type ProfileParams,
  type ProjectDocument,
  type Shape,
  type Tool,
} from "@furrow/document";
import { DRAWING_ID } from "@furrow/document/fixtures";
import { describe, expect, it } from "vitest";
import { signedArea } from "../geometry/clipper";
import { translatePath } from "../geometry/translate";
import type { Vec3 } from "../scene/stock";
import { DEFAULT_SAFE_Z, generateToolpath, toolpathInput } from "./generate";
import { excludeOvercuts } from "./overcuts";
import { depthLevels } from "./passes";
import { profileOvercuts, profileToolpath } from "./profile";
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
  taperAngle: null,
  spindleRpm: 18000,
  feedRate: 1500,
  plungeRate: 500,
  plungeAngle: 3,
  stepDown: 2,
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
  startPoints: [],
  cornerOvercuts: null,
  entries: [],
};

/** 100 × 100 mm, counter-clockwise. */
const square: Shape = {
  id: "4f8a1c2e-6b3d-4e5f-9a7b-8c9d0e1f2a3b",
  name: "Square",
  layer: "0",
  drawingId: DRAWING_ID,
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
  drawingId: DRAWING_ID,
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
  drawingId: DRAWING_ID,
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
    stockSide: "top",
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

  it("ramps along a short line and back, never plunging at the feed rate", () => {
    // 2 mm at 3° is about 38 mm of travel: more than twice the 8 mm line.
    const short: Shape = {
      ...line,
      paths: [{ start: [10, 10], segments: [{ kind: "line", to: [18, 10] }], closed: false }],
    };
    const toolpath = profile({ side: "on", ramp: true }, [short]);
    let ramps = 0;
    for (const [from, move] of steps(toolpath)) {
      if (move.kind !== "feed" || move.to[2] >= from[2] || from[2] > 0) continue;
      ramps++;
      expect(descentAngle(from, move.to)).toBeLessThanOrEqual(3 + 1e-6);
      expect(move.feedRate).toBe(tool.plungeRate);
      expect(move.to[1]).toBe(10);
      expect(move.to[0]).toBeGreaterThanOrEqual(10);
      expect(move.to[0]).toBeLessThanOrEqual(18);
    }
    expect(ramps).toBeGreaterThan(3);
  });

  it("ramps along a short open polyline without leaving it", () => {
    const bend: Shape = {
      ...line,
      paths: [
        {
          start: [10, 10],
          segments: [
            { kind: "line", to: [15, 10] },
            { kind: "line", to: [15, 15] },
            { kind: "line", to: [20, 15] },
          ],
          closed: false,
        },
      ],
    };
    const onBend = ([x, y]: Vec3) =>
      (Math.abs(y - 10) < 1e-9 && x >= 10 - 1e-9 && x <= 15 + 1e-9) ||
      (Math.abs(x - 15) < 1e-9 && y >= 10 - 1e-9 && y <= 15 + 1e-9) ||
      (Math.abs(y - 15) < 1e-9 && x >= 15 - 1e-9 && x <= 20 + 1e-9);
    const toolpath = profile({ side: "on", ramp: true }, [bend]);
    let ramps = 0;
    for (const [from, move] of steps(toolpath)) {
      if (move.kind !== "feed" || from[2] > 0) continue;
      if (move.to[2] < from[2]) ramps++;
      // Every move below the top is along the path: no chord across the bend.
      expect(onBend(move.to)).toBe(true);
      expect(onBend([(from[0] + move.to[0]) / 2, (from[1] + move.to[1]) / 2, 0])).toBe(true);
    }
    expect(ramps).toBeGreaterThan(3);
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

  /** A closed polygon through `corners` as a shape. */
  function polygon(corners: [number, number][]): Shape {
    const [start, ...rest] = corners as [[number, number], ...[number, number][]];
    return {
      ...square,
      paths: [{ start, segments: rest.map((to) => ({ kind: "line" as const, to })), closed: true }],
    };
  }

  /** The finish lap's entry: straight down from the top to `depth`. */
  function straightPlunges(toolpath: Toolpath, depth: number) {
    return steps(toolpath).filter(
      ([from, move]) => from[2] === 0 && move.to[2] === depth && move.to[0] === from[0],
    );
  }

  /** Every move into `region`, checked to go no more than a step-down below the deepest cut there so far. */
  function expectStepsDown(
    toolpath: Toolpath,
    region: (x: number, y: number) => boolean,
    stepDown: number,
  ) {
    let deepest = 0;
    let entered = 0;
    for (const [from, move] of steps(toolpath)) {
      if (move.kind !== "feed") continue;
      for (let t = 0.1; t <= 1; t += 0.1) {
        const x = from[0] + (move.to[0] - from[0]) * t;
        const y = from[1] + (move.to[1] - from[1]) * t;
        const z = from[2] + (move.to[2] - from[2]) * t;
        if (!region(x, y) || z >= 0) continue;
        entered++;
        expect(z).toBeGreaterThanOrEqual(deepest - stepDown - 1e-6);
        deepest = Math.min(deepest, z);
      }
    }
    expect(entered).toBeGreaterThan(0);
    expect(deepest).toBeCloseTo(-18, 6);
  }

  // A 6.35 mm bit and 0.2 mm allowance: a 6.5 mm gap fits the finishing
  // offset but not the roughing one.
  const bit = { diameter: 6.35, fluteLength: 25 };
  const finished = { allowance: 0.2, finishPass: true, depth: 18 };

  const notched = polygon([
    [0, 0],
    [100, 0],
    [100, 50],
    [46.5, 50],
    [46.5, 30],
    [40, 30],
    [40, 50],
    [0, 50],
  ]);

  // Up to an allowance just over the tool radius, where the bridged notch is
  // narrower than the finishing stock along the walls.
  it.each([0.2, 3.3, 3.5])(
    "cuts a notch the depth passes bridge in depth passes too (allowance %s)",
    (allowance) => {
      const toolpath = profile({ ...finished, allowance }, [notched], bit);
      expectStepsDown(toolpath, (x, y) => x > 40 && x < 46.5 && y > 30 && y < 48, 2);
    },
  );

  it("cuts only around a bridged notch in depth passes, then one finish lap", () => {
    const toolpath = profile(finished, [notched], bit);
    expect(straightPlunges(toolpath, -18)).toHaveLength(1);
    const finishing = (x: number, y: number) =>
      Math.abs(y + bit.diameter / 2) < 1e-6 || Math.abs(x - 100 - bit.diameter / 2) < 1e-6;
    // The finishing offset of the walls away from the notch is only cut at full depth.
    const walls = steps(toolpath).filter(
      ([from, move]) => finishing(from[0], from[1]) && finishing(move.to[0], move.to[1]),
    );
    expect(walls.length).toBeGreaterThan(0);
    expect(walls.every(([from, move]) => from[2] === -18 && move.to[2] === -18)).toBe(true);
  });

  it("finishes each hole of a part with a single lap", () => {
    const holes = [20, 50, 80].map((x) => ({
      ...hole,
      paths: hole.paths.map((path) => translatePath(path, [x - 50, 0])),
    }));
    const toolpath = profile({ allowance: 0.5, finishPass: true }, [square, ...holes]);
    expect(straightPlunges(toolpath, -6)).toHaveLength(4);
  });

  it("cuts a neck the depth passes can't pass in depth passes too", () => {
    const dumbbell = polygon([
      [0, 0],
      [40, 0],
      [40, 16.75],
      [60, 16.75],
      [60, 0],
      [100, 0],
      [100, 40],
      [60, 40],
      [60, 23.25],
      [40, 23.25],
      [40, 40],
      [0, 40],
    ]);
    const toolpath = profile({ ...finished, side: "inside" }, [dumbbell], bit);
    expectStepsDown(toolpath, (x, y) => x > 42 && x < 58 && y > 16.75 && y < 23.25, 2);
  });

  it("keeps the single finish lap around inside corners", () => {
    const ell = polygon([
      [0, 0],
      [100, 0],
      [100, 40],
      [40, 40],
      [40, 100],
      [0, 100],
    ]);
    const toolpath = profile({ allowance: 0.5, finishPass: true }, [ell]);
    expect(straightPlunges(toolpath, -6)).toHaveLength(1);
  });

  // A 50° V-notch in an outline, and a star hole with 36° points: the
  // finishing tool reaches further into these corners than the roughing one.
  const vNotched = polygon([
    [0, 0],
    [100, 0],
    [100, 50],
    [60, 50],
    [50, 50 - 10 / Math.tan((25 * Math.PI) / 180)],
    [40, 50],
    [0, 50],
  ]);
  const star = polygon(
    Array.from({ length: 10 }, (_, i): [number, number] => {
      const r = i % 2 === 0 ? 40 : (40 * Math.sin(Math.PI / 10)) / Math.sin((3 * Math.PI) / 10);
      const angle = (i * Math.PI) / 5;
      return [50 + r * Math.cos(angle), 50 + r * Math.sin(angle)];
    }),
  );

  it.each([
    ["outside", vNotched],
    ["inside", star],
  ] as const)("keeps the single finish lap around acute corners (%s)", (side, shape) => {
    const toolpath = profile({ ...finished, side }, [shape], bit);
    expect(straightPlunges(toolpath, -18)).toHaveLength(1);
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
    expect(toolpath.warnings).toEqual([{ code: "toolpath.leadInMisfits", values: { count: 1 } }]);
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
      { code: "toolpath.skippedPoints", values: { count: 1 } },
      { code: "toolpath.skippedOpenProfile", values: { count: 1 } },
    ]);
    expect(profile({ side: "inside" }, [square], { diameter: 120 }).warnings).toEqual([
      { code: "toolpath.pathsTooSmall" },
    ]);
    expect(profile({ depth: 30 }).warnings).toEqual([{ code: "toolpath.depthExceedsFlutes" }]);
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

  it("drops straight back down after each tab, even when ramping (#153)", () => {
    const top = -3;
    const descents = (toolpath: Toolpath) =>
      steps(toolpath).filter(
        ([from, move]) => move.kind === "feed" && from[2] === top && move.to[2] < top,
      );
    for (const ramp of [true, false]) {
      const toolpath = profile({ ramp, tabs: tabs(midSides) });
      expect(descents(toolpath).length).toBeGreaterThan(0);
      for (const [from, move] of descents(toolpath)) {
        // Straight down at the tab's edge, at the plunge rate…
        expect(move.to.slice(0, 2)).toEqual(from.slice(0, 2));
        expect(move).toMatchObject({ feedRate: tool.plungeRate });
      }
      expect(intrusions(toolpath, top)).toEqual([]);
    }
    // …so past the tab the edge is cut at full depth: no wedge behind it.
    const last = profile({ ramp: true, tabs: tabs([[50, 0]]) });
    const bottom = cutsAt(last, -6).filter(([x, y]) => Math.abs(y + 3) < 1e-6 && x > 55);
    expect(bottom.length).toBeGreaterThan(0);
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
    ).toEqual([{ code: "toolpath.tabsLeftOut", values: { count: 1 } }]);
    // Near enough to the depth passes (3.5 mm out) but not to the finish lap (3 mm out).
    const finishing = profile({ allowance: 0.5, finishPass: true, tabs: tabs([[50, -10.5]]) });
    expect(finishing.warnings).toEqual([{ code: "toolpath.tabsLeftOut", values: { count: 1 } }]);
    const tall = profile({ tabs: { width: 4, height: 6, positions: [[50, 0]] } });
    expect(tall.warnings).toEqual([{ code: "toolpath.tabsTooTall" }]);
    expect(Math.max(...tall.moves.filter((m) => m.kind === "feed").map((m) => m.to[2]))).toBe(0);
  });

  it("cuts all the way round without positions", () => {
    expect(profile({ tabs: tabs([]) })).toEqual(profile());
  });
});

describe("profileToolpath with start points", () => {
  /** Where the tool first reaches the stock top. */
  const entry = (toolpath: Toolpath) => toolpath.moves.find((move) => move.to[2] === 0)?.to;

  it("starts a closed contour at its start point, plunging, ramping or leading in", () => {
    for (const ramp of [false, true]) {
      const toolpath = profile({ ramp, startPoints: [[0, 30]] });
      expect(entry(toolpath)?.[0]).toBeCloseTo(-3, 6);
      expect(entry(toolpath)?.[1]).toBeCloseTo(30, 6);
      expect(toolpath.warnings).toEqual([]);
    }
    const led = profile({ leadIn: { radius: 3 }, startPoints: [[0, 30]] });
    const arcEnd = led.moves.find(
      (move) => move.to[2] === -2 && Math.abs(move.to[0] + 3) < 1e-6,
    )?.to;
    expect(arcEnd?.[1]).toBeCloseTo(30, 6);
  });

  it("starts the finish lap at the matching point of the exact contour", () => {
    const toolpath = profile({ allowance: 0.5, finishPass: true, startPoints: [[0, 30]] });
    expect(entry(toolpath)?.[0]).toBeCloseTo(-3.5, 6);
    // Across from the slot to the exact contour at full depth.
    const across = steps(toolpath).find(
      ([from, move]) =>
        from[2] === -6 &&
        move.to[2] === -6 &&
        Math.abs(from[0] + 3.5) < 1e-6 &&
        Math.abs(move.to[0] + 3) < 1e-6,
    );
    expect(across?.[0][1]).toBeCloseTo(30, 6);
    expect(across?.[1].to[1]).toBeCloseTo(30, 6);
  });

  it("cuts an open path from its start point's end on every pass, back above the stock between", () => {
    const toolpath = profile({ side: "on", startPoints: [[88, 10]] }, [line]);
    expect(toolpath.warnings).toEqual([]);
    expect(entry(toolpath)?.slice(0, 2)).toEqual([90, 10]);
    const ends = [-2, -4, -6].map((z) => cutsAt(toolpath, z).at(-1)?.[0]);
    expect(ends).toEqual([10, 10, 10]);
    // A retract and a rapid back to the start before each pass after the first.
    const backs = toolpath.moves.filter(
      (move) => move.kind === "rapid" && move.to[0] === 90 && move.to[2] === 5,
    );
    expect(backs).toHaveLength(3);
  });

  it("moves a start point on a tab to the nearer end of the tab", () => {
    const tabs = { width: 4, height: 3, positions: [[0, 50]] as [number, number][] };
    const toolpath = profile({ tabs, startPoints: [[0, 52]] });
    // Outside, climbing, the left side is cut upwards; the tab spans 45 to 55 there.
    expect(entry(toolpath)?.[0]).toBeCloseTo(-3, 6);
    expect(entry(toolpath)?.[1]).toBeCloseTo(55, 6);
    expect(toolpath.warnings).toEqual([
      { code: "toolpath.startPointsOnTabs", values: { count: 1 } },
    ]);
    const below = steps(toolpath).filter(
      ([from, move]) =>
        move.kind === "feed" &&
        Math.min(from[2], move.to[2]) < -3 &&
        Math.abs(move.to[0] + 3) < 1e-6 &&
        move.to[1] > 45 + 1e-6 &&
        move.to[1] < 55 - 1e-6,
    );
    expect(below).toEqual([]);
  });

  it("leaves out start points too far from every path or extra on a path", () => {
    const far = profile({ startPoints: [[500, 500]] });
    expect(far.warnings).toEqual([{ code: "toolpath.startPointsLeftOut", values: { count: 1 } }]);
    const { warnings, ...moves } = far;
    expect(moves).toEqual((({ warnings: _, ...rest }) => rest)(profile()));
    const extra = profile({
      startPoints: [
        [0, 30],
        [0, 60],
      ],
    });
    expect(extra.warnings).toEqual([{ code: "toolpath.startPointsLeftOut", values: { count: 1 } }]);
    expect(entry(extra)?.[1]).toBeCloseTo(30, 6);
    // Off the drawn path, even within a tool radius of it.
    expect(profile({ startPoints: [[-1, 30]] }).warnings).toHaveLength(1);
  });

  it("starts at a sharp corner, where the contour is further than the offset", () => {
    // Inside, the 3 mm offset of the corner at (0, 0) is (3, 3), 4.24 mm away.
    const toolpath = profile({ side: "inside", startPoints: [[0, 0]] });
    expect(toolpath.warnings).toEqual([]);
    expect(entry(toolpath)?.[0]).toBeCloseTo(3, 6);
    expect(entry(toolpath)?.[1]).toBeCloseTo(3, 6);
  });

  it("leaves out a start point on a path too small for a contour of its own", () => {
    const small: Shape = {
      ...line,
      paths: [
        {
          start: [45, 45],
          segments: [
            { kind: "line", to: [49, 45] },
            { kind: "line", to: [49, 49] },
            { kind: "line", to: [45, 49] },
          ],
          closed: true,
        },
      ],
    };
    // Outside the part, the 4 mm hole closes up: the outline's contour is the only one.
    const toolpath = profile({ side: "outside", startPoints: [[45, 47]] }, [square, small]);
    expect(toolpath.warnings).toContainEqual({
      code: "toolpath.startPointsLeftOut",
      values: { count: 1 },
    });
  });
});

describe("profileToolpath with entry points", () => {
  const plunge: [number, number] = [-20, 30];
  const entries = [{ start: [0, 30] as [number, number], plunge }];
  const at = (point: Vec3, [x, y]: [number, number]) =>
    Math.abs(point[0] - x) < 1e-6 && Math.abs(point[1] - y) < 1e-6;

  it("goes up and down only at the plunge point, ramping and leading in or not", () => {
    for (const overrides of [{}, { ramp: true, leadIn: { radius: 3 } }]) {
      const toolpath = profile({ ...overrides, entries });
      expect(toolpath.warnings).toEqual([]);
      const vertical = steps(toolpath).filter(
        ([from, move]) => from[2] !== move.to[2] && Math.min(from[2], move.to[2]) < 5,
      );
      expect(vertical.every(([from, move]) => at(from, plunge) && at(move.to, plunge))).toBe(true);
      for (const z of [-2, -4, -6]) {
        // In along the lead to the start, the whole lap, and back out to the plunge point.
        const cuts = cutsAt(toolpath, z);
        expect(cuts[0]?.[0]).toBeCloseTo(-3, 6);
        expect(cuts[0]?.[1]).toBeCloseTo(30, 6);
        expect(cuts.at(-2)?.[0]).toBeCloseTo(-3, 6);
        expect(cuts.at(-2)?.[1]).toBeCloseTo(30, 6);
        expect(cuts.at(-1)).toEqual(plunge);
      }
    }
  });

  it("enters the finish lap from the plunge point too", () => {
    const toolpath = profile({ allowance: 0.5, finishPass: true, entries });
    expect(toolpath.warnings).toEqual([]);
    const vertical = steps(toolpath).filter(
      ([from, move]) => from[2] !== move.to[2] && Math.min(from[2], move.to[2]) < 5,
    );
    expect(vertical.every(([from, move]) => at(from, plunge) && at(move.to, plunge))).toBe(true);
    // The last roughing lap at -3.5, then the finishing one at -3, both led in from the plunge point.
    const leads = steps(toolpath)
      .filter(([from, move]) => from[2] === -6 && move.to[2] === -6 && at(from, plunge))
      .map(([, move]) => [move.to[0], move.to[1]]);
    expect(leads.map(([x]) => x)).toEqual([-3.5, -3]);
    for (const [, y] of leads) expect(y).toBeCloseTo(30, 6);
  });

  it("warns about entries off every contour, and leads into the part", () => {
    expect(profile({ entries: [{ start: [500, 500], plunge }] }).warnings).toEqual([
      { code: "toolpath.entriesLeftOut", values: { count: 1 } },
    ]);
    const inPart = { code: "toolpath.entriesInPart", values: { count: 1 } };
    // Plunging in the part, or across it from the far side.
    expect(profile({ entries: [{ start: [0, 30], plunge: [50, 30] }] }).warnings).toEqual([inPart]);
    expect(profile({ entries: [{ start: [0, 30], plunge: [110, 30] }] }).warnings).toEqual([
      inPart,
    ]);
    // A lead within the tool radius of the part cuts into it.
    expect(profile({ entries: [{ start: [0, 30], plunge: [-2, 60] }] }).warnings).toEqual([inPart]);
    // Inside, the waste is in the middle.
    expect(
      profile({ side: "inside", entries: [{ start: [0, 30], plunge: [50, 50] }] }).warnings,
    ).toEqual([]);
    expect(profile({ side: "inside", entries }).warnings).toEqual([inPart]);
    // On the line there is no part side: a plunge in the middle frees a hole.
    expect(
      profile({ side: "on", entries: [{ start: [0, 30], plunge: [50, 50] }] }).warnings,
    ).toEqual([]);
  });
});

describe("profileToolpath with corner overcuts", () => {
  const overcuts = { maxAngle: 90, excluded: [] };
  /** 100 × 100 mm with a 50 × 50 mm notch out of its top right, counter-clockwise. */
  const lShape: Shape = {
    ...square,
    id: "5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b",
    paths: [
      {
        start: [0, 0],
        segments: [
          { kind: "line", to: [100, 0] },
          { kind: "line", to: [100, 50] },
          { kind: "line", to: [50, 50] },
          { kind: "line", to: [50, 100] },
          { kind: "line", to: [0, 100] },
        ],
        closed: true,
      },
    ],
  };
  const corners: [number, number][] = [
    [0, 0],
    [100, 0],
    [100, 100],
    [0, 100],
  ];
  /** The closest the tool centre comes to `corner` in XY, on the moves `at` heights it allows. */
  const nearest = (toolpath: Toolpath, corner: [number, number], at = (_z: number) => true) =>
    Math.min(
      ...toolpath.moves
        .filter((move) => move.kind === "feed" && at(move.to[2]))
        .map(({ to }) => Math.hypot(to[0] - corner[0], to[1] - corner[1])),
    );

  it("overcuts each corner of a cutout until the tool's edge touches it, on every pass", () => {
    const toolpath = profile({ side: "inside", cornerOvercuts: overcuts });
    for (const corner of corners) {
      for (const level of depthLevels(params.depth, tool.stepDown)) {
        expect(nearest(toolpath, corner, (z) => Math.abs(z - level) < 1e-9)).toBeCloseTo(3, 3);
      }
    }
    // Without them the tool stays r√2 off each corner.
    expect(nearest(profile({ side: "inside" }), [0, 0])).toBeCloseTo(3 * Math.SQRT2, 3);
  });

  it("overcuts only the inside corners of a part", () => {
    expect(profile({ cornerOvercuts: overcuts })).toEqual(profile());
    const toolpath = profile({ cornerOvercuts: overcuts }, [lShape]);
    expect(nearest(toolpath, [50, 50])).toBeCloseTo(3, 3);
    expect(nearest(profile({}, [lShape]), [50, 50])).toBeCloseTo(3 * Math.SQRT2, 3);
    const without = profile({}, [lShape]);
    // One overcut, out and back: two more moves per pass.
    expect(toolpath.moves.length - without.moves.length).toBe(
      2 * depthLevels(params.depth, tool.stepDown).length,
    );
  });

  it("leaves out corners wider than the angle, curves and smooth joins", () => {
    expect(profile({ cornerOvercuts: { ...overcuts, maxAngle: 89 } }, [lShape])).toEqual(
      profile({}, [lShape]),
    );
    // A slot: two straights joined by half circles, each tangent to them.
    const slot: Shape = {
      ...square,
      paths: [
        {
          start: [0, 0],
          segments: [
            { kind: "line", to: [100, 0] },
            { kind: "arc", to: [100, 20], center: [100, 10], clockwise: false },
            { kind: "line", to: [0, 20] },
            { kind: "arc", to: [0, 0], center: [0, 10], clockwise: false },
          ],
          closed: true,
        },
      ],
    };
    for (const shape of [hole, slot]) {
      expect(
        profile({ side: "inside", cornerOvercuts: { ...overcuts, maxAngle: 180 } }, [shape]),
      ).toEqual(profile({ side: "inside" }, [shape]));
    }
  });

  it("stops the depth passes the allowance short, and reaches the corner on the finish lap", () => {
    const toolpath = profile({
      side: "inside",
      allowance: 0.5,
      finishPass: true,
      cornerOvercuts: overcuts,
    });
    expect(nearest(toolpath, [0, 0], (z) => z > -params.depth)).toBeCloseTo(3.5, 3);
    expect(nearest(toolpath, [0, 0])).toBeCloseTo(3, 3);
  });

  it("leaves out the overcut whose corner each excluded point is on, and none for others", () => {
    const toolpath = profile({
      side: "inside",
      cornerOvercuts: {
        ...overcuts,
        excluded: [
          [0, 100],
          [5, 90],
        ],
      },
    });
    expect(nearest(toolpath, [0, 100])).toBeCloseTo(3 * Math.SQRT2, 3);
    for (const corner of corners.slice(0, 3)) expect(nearest(toolpath, corner)).toBeCloseTo(3, 3);
  });

  it("starts on the contour's corner, not out on its overcut, for a start point there", () => {
    const toolpath = profile({ side: "inside", startPoints: [[0, 0]], cornerOvercuts: overcuts });
    const first = toolpath.moves.find((move) => move.kind === "feed");
    expect(first?.to[0]).toBeCloseTo(3, 6);
    expect(first?.to[1]).toBeCloseTo(3, 6);
    expect(nearest(toolpath, [0, 0])).toBeCloseTo(3, 3);
  });

  it("keeps tabs where they are, and the tool at the tab top over an overcut a tab covers", () => {
    const tabs = (positions: [number, number][]) => ({ width: 4, height: 3, positions });
    const midSides: [number, number][] = [
      [50, 0],
      [100, 50],
      [50, 100],
      [0, 50],
    ];
    expect(
      cutsAt(profile({ side: "inside", tabs: tabs(midSides), cornerOvercuts: overcuts }), -3),
    ).toEqual(cutsAt(profile({ side: "inside", tabs: tabs(midSides) }), -3));
    const covered = profile({ side: "inside", tabs: tabs([[3, 0]]), cornerOvercuts: overcuts });
    const tip = 3 / Math.SQRT2;
    expect(cutsAt(covered, -3).some(([x, y]) => Math.hypot(x - tip, y - tip) < 1e-6)).toBe(true);
    expect(nearest(covered, [0, 0], (z) => z < -3)).toBeGreaterThan(3 * Math.SQRT2 - 1e-6);
  });

  it("lists the overcuts of the finished contour at the drawn corners", () => {
    const found = excludeOvercuts(profileOvercuts([square], "inside", 3, 90), [[0, 100]]);
    expect(found).toHaveLength(4);
    for (const { corner, tip, excludedBy } of found) {
      const drawn = corners.find(([x, y]) => Math.hypot(corner[0] - x, corner[1] - y) < 1e-3);
      expect(drawn).toBeDefined();
      expect(Math.hypot(tip[0] - corner[0], tip[1] - corner[1])).toBeCloseTo(3, 3);
      expect(excludedBy).toEqual(drawn?.[0] === 0 && drawn[1] === 100 ? [0] : []);
    }
    expect(profileOvercuts([square], "outside", 3, 90)).toEqual([]);
  });

  it("leaves out one more of the overcuts at a corner two cutouts share for each point on it", () => {
    const touching: Shape = {
      ...square,
      id: "6f7a8b9c-0d1e-4f2a-8b3c-4d5e6f7a8b9c",
      paths: square.paths.map((path) => translatePath(path, [100, 100])),
    };
    const found = profileOvercuts([square, touching], "inside", 3, 90);
    const shared = (excluded: [number, number][]) =>
      excludeOvercuts(found, excluded)
        .filter(({ corner }) => Math.hypot(corner[0] - 100, corner[1] - 100) < 1e-3)
        .map(({ excludedBy }) => excludedBy.length)
        .sort();
    expect(shared([])).toEqual([0, 0]);
    expect(shared([[100, 100]])).toEqual([0, 1]);
    expect(
      shared([
        [100, 100],
        [100, 100],
      ]),
    ).toEqual([1, 1]);
  });
});

describe("generateToolpath", () => {
  const doc = (machineSafeZ: number | null, entryClearance = 1): ProjectDocument => ({
    schemaVersion: CURRENT_SCHEMA_VERSION,
    units: "mm",
    stock: {
      width: 200,
      height: 200,
      thickness: 18,
      xyOrigin: { anchor: "bottom_left" },
      zOrigin: "stock_top",
      touchOff: null,
      twoSided: null,
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
            accelerationXY: null,
            accelerationZ: null,
            spindleRpmMin: null,
            spindleRpmMax: null,
            spinUpDelay: 5,
            safeZ: machineSafeZ,
            entryClearance,
            postProcessor: "grbl",
            programStart: null,
            programEnd: null,
            operationStart: null,
            toolChange: null,
          },
    machineId: null,
    drawings: [{ id: DRAWING_ID, name: "", border: 10, rotation: 0 }],
    geometry: [square, hole],
    models: [],
    fonts: [],
    operations: [
      {
        id: "11111111-2222-4333-8444-555555555555",
        name: "Profile",
        enabled: true,
        stockSide: "top",
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

  it("refuses a drill bit, which can't cut sideways", () => {
    const saved = doc(12);
    const [profile] = saved.operations;
    if (!profile) throw new Error("No profile");
    profile.tool = { ...tool, type: "drill", cutDirection: null, plungeAngle: 90 };
    expect(generateToolpath(toolpathInput(saved, profile.id))).toEqual({
      moves: [],
      warnings: [{ code: "operation.drillsCantCutSideways" }],
    });
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
