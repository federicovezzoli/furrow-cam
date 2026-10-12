import type { PocketOperation, PocketParams, Shape, Tool } from "@furrow/document";
import { describe, expect, it } from "vitest";
import { generateToolpath } from "./generate";
import { ENTRY_CLEARANCE } from "./passes";
import { pocketToolpath } from "./pocket";
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

const params: PocketParams = {
  direction: "climb",
  depth: 6,
  allowance: 0,
  finishPass: false,
  ramp: false,
};

function rectangle(id: string, x: number, y: number, width: number, height: number): Shape {
  return {
    id,
    name: "Rectangle",
    layer: "0",
    paths: [
      {
        start: [x, y],
        segments: [
          { kind: "line", to: [x + width, y] },
          { kind: "line", to: [x + width, y + height] },
          { kind: "line", to: [x, y + height] },
        ],
        closed: true,
      },
    ],
  };
}

/** 100 × 100 mm. */
const square = rectangle("4f8a1c2e-6b3d-4e5f-9a7b-8c9d0e1f2a3b", 0, 0, 100, 100);

/** Radius 10 around (50, 50), drawn as its own shape: an island in the square. */
const island: Shape = {
  id: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
  name: "Island",
  layer: "0",
  paths: [
    {
      start: [60, 50],
      segments: [{ kind: "arc", to: [60, 50], center: [50, 50], clockwise: false }],
      closed: true,
    },
  ],
};

function pocket(
  overrides: Partial<PocketParams> = {},
  shapes: Shape[] = [square],
  toolOverrides: Partial<Tool> = {},
): Toolpath {
  return pocketToolpath(operation(overrides, shapes, toolOverrides), shapes, { safeZ: 5 });
}

function operation(
  overrides: Partial<PocketParams> = {},
  shapes: Shape[] = [square],
  toolOverrides: Partial<Tool> = {},
): PocketOperation {
  return {
    id: "11111111-2222-4333-8444-555555555555",
    name: "Pocket",
    enabled: true,
    type: "pocket",
    targets: shapes.map((shape) => ({ shapeId: shape.id, paths: null })),
    tool: { ...tool, ...toolOverrides },
    params: { ...params, ...overrides },
  };
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

/** Feed moves that stay at height `z`, as 2D segments. */
function cutsAt(toolpath: Toolpath, z: number): [[number, number], [number, number]][] {
  return steps(toolpath)
    .filter(([from, move]) => move.kind === "feed" && from[2] === z && move.to[2] === z)
    .map(([from, move]) => [
      [from[0], from[1]],
      [move.to[0], move.to[1]],
    ]);
}

/** Every move below the stock top, as 2D segments. */
function cutsBelowTop(toolpath: Toolpath): [[number, number], [number, number]][] {
  return steps(toolpath)
    .filter(([from, move]) => from[2] < 0 || move.to[2] < 0)
    .map(([from, move]) => [
      [from[0], from[1]],
      [move.to[0], move.to[1]],
    ]);
}

function distanceToSegment(
  point: [number, number],
  [a, b]: [[number, number], [number, number]],
): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared > 0
      ? Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / lengthSquared))
      : 0;
  return Math.hypot(point[0] - a[0] - t * dx, point[1] - a[1] - t * dy);
}

/** Grid points every `spacing` millimetres for which `keep` holds, that the tool centre at `z` comes no nearer than `reach` to. */
function missed(
  toolpath: Toolpath,
  z: number,
  reach: number,
  keep: (point: [number, number]) => boolean,
  spacing = 1,
): [number, number][] {
  const cuts = cutsAt(toolpath, z);
  const result: [number, number][] = [];
  for (let x = 0; x <= 100; x += spacing) {
    for (let y = 0; y <= 100; y += spacing) {
      const point: [number, number] = [x, y];
      if (!keep(point)) continue;
      if (cuts.every((cut) => distanceToSegment(point, cut) > reach)) result.push(point);
    }
  }
  return result;
}

/** Rapids that go up to the retract height from below it. */
function retracts(toolpath: Toolpath): number {
  return steps(toolpath).filter(
    ([from, move]) => move.kind === "rapid" && move.to[2] === 5 && from[2] < 5,
  ).length;
}

/** Inside the square, where a round tool can reach: everything but its corners. */
const inSquare = ([x, y]: [number, number]) =>
  x > 0 &&
  x < 100 &&
  y > 0 &&
  y < 100 &&
  Math.hypot(Math.max(0, 3 - x, x - 97), Math.max(0, 3 - y, y - 97)) <= 3;
const offIsland = ([x, y]: [number, number]) => Math.hypot(x - 50, y - 50) > 10;

describe("pocketToolpath", () => {
  it("clears the whole pocket at every depth, down to the final depth", () => {
    const toolpath = pocket();
    for (const z of [-2, -4, -6]) {
      // Material within the tool radius of the walls is the wall itself.
      expect(missed(toolpath, z, 3 + 1e-3, inSquare)).toEqual([]);
    }
    expect(Math.min(...toolpath.moves.map((move) => move.to[2]))).toBe(-6);
    expect(toolpath.warnings).toEqual([]);
  });

  it("keeps the tool centre a radius away from the walls", () => {
    for (const cut of cutsBelowTop(pocket()).flat()) {
      for (const value of cut) {
        expect(value).toBeGreaterThanOrEqual(3 - 1e-3);
        expect(value).toBeLessThanOrEqual(97 + 1e-3);
      }
    }
  });

  it("steps over no more than the tool's step-over", () => {
    // With a step-over of 40% each ring is 2.4 mm further in: a 94 mm square of
    // tool centres needs 20 rings to reach the middle.
    const moves = pocket().moves.filter((move) => move.to[2] === -2);
    const rings = new Set(
      moves.map((move) =>
        Math.round(Math.max(Math.abs(move.to[0] - 50), Math.abs(move.to[1] - 50)) * 10),
      ),
    );
    const sizes = [...rings].sort((a, b) => b - a).map((size) => size / 10);
    expect(sizes[0]).toBeCloseTo(47, 2);
    for (let i = 1; i < sizes.length; i++) {
      expect((sizes[i - 1] as number) - (sizes[i] as number)).toBeLessThanOrEqual(2.4 + 1e-3);
    }
  });

  it("clears around islands without cutting them", () => {
    const toolpath = pocket({}, [square, island]);
    for (const z of [-2, -4, -6]) {
      expect(missed(toolpath, z, 3 + 1e-3, (p) => inSquare(p) && offIsland(p))).toEqual([]);
    }
    for (const [a, b] of cutsBelowTop(toolpath)) {
      expect(distanceToSegment([50, 50], [a, b])).toBeGreaterThanOrEqual(13 - 1e-2);
    }
  });

  it("clears pockets inside islands", () => {
    const inner = rectangle("0d9c8b7a-6f5e-4d3c-ab1a-0f9e8d7c6b5a", 40, 40, 20, 20);
    const toolpath = pocket({}, [square, island, inner]);
    const cuts = cutsAt(toolpath, -6);
    const inInner = cuts.filter(([a]) => a[0] > 40 && a[0] < 60 && a[1] > 40 && a[1] < 60);
    expect(inInner.length).toBeGreaterThan(0);
    for (const [a] of inInner) {
      expect(Math.max(Math.abs(a[0] - 50), Math.abs(a[1] - 50))).toBeLessThanOrEqual(7 + 1e-3);
    }
  });

  it("clears the middle with a step-over over half the diameter", () => {
    for (const stepOver of [60, 90, 100]) {
      const toolpath = pocket({ depth: 2 }, [square, island], { stepOver });
      expect(missed(toolpath, -2, 3 + 1e-2, (p) => inSquare(p) && offIsland(p), 0.5)).toEqual([]);
    }
  });

  it("cuts from the centre out", () => {
    const toolpath = pocket();
    // The first pass, up to the plunge into the second.
    const firstPass = toolpath.moves.slice(
      0,
      toolpath.moves.findIndex((move) => move.to[2] < -2),
    );
    // Less the move back to the middle for the second pass.
    const cuts = cutsAt({ moves: firstPass, warnings: [] }, -2).slice(0, -1);
    const offCentre = ([x, y]: [number, number]) => Math.max(Math.abs(x - 50), Math.abs(y - 50));
    expect(offCentre(cuts[0]?.[0] as [number, number])).toBeLessThan(3);
    const sizes = cuts.map(([, b]) => offCentre(b));
    expect(Math.max(...sizes)).toBeCloseTo(47, 2);
    // Each ring is cut before any further out.
    let reached = 0;
    for (const size of sizes) {
      expect(size).toBeGreaterThanOrEqual(reached - 2.4 - 1e-3);
      reached = Math.max(reached, size);
    }
  });

  it("climbs counter-clockwise along the walls and clockwise around islands", () => {
    // Up the right wall and down around the island's right side.
    const rising = (toolpath: Toolpath, x: number) =>
      cutsAt(toolpath, -6)
        .filter(([a, b]) => Math.abs(a[0] - x) < 1e-3 && Math.abs(b[0] - x) < 1e-3)
        .map(([a, b]) => Math.sign(b[1] - a[1]));
    expect(rising(pocket({}, [square, island]), 97)).toContain(1);
    expect(rising(pocket({}, [square, island]), 97)).not.toContain(-1);
    const conventional = pocket({ direction: "conventional" }, [square, island]);
    expect(rising(conventional, 97)).not.toContain(1);

    const aroundIsland = cutsAt(pocket({}, [square, island]), -6).filter(
      ([a]) => Math.abs(Math.hypot(a[0] - 50, a[1] - 50) - 13) < 1e-2 && a[0] > 62,
    );
    expect(aroundIsland.length).toBeGreaterThan(0);
    for (const [a, b] of aroundIsland) expect(b[1]).toBeLessThanOrEqual(a[1] + 1e-9);
  });

  it("retracts only at the end of a pocket", () => {
    for (const ramp of [false, true]) {
      expect(retracts(pocket({ ramp }))).toBe(1);
      expect(retracts(pocket({ ramp }, [square, island]))).toBe(1);
      const finished = pocket({ ramp, allowance: 0.5, finishPass: true }, [square, island]);
      expect(retracts(finished)).toBe(1);
    }
  });

  it("crosses above the stock on the first pass and at the cleared depth after", () => {
    const toolpath = pocket({}, [square, island]);
    const across = steps(toolpath).filter(
      ([from, move]) =>
        from[2] === move.to[2] && Math.hypot(move.to[0] - from[0], move.to[1] - from[1]) > 6,
    );
    expect(across.length).toBeGreaterThan(0);
    for (const [from, move] of across) {
      if (from[2] > 0)
        expect(move).toMatchObject({ kind: "rapid", to: [move.to[0], move.to[1], 1] });
      else expect([-2, -4, -6]).toContain(from[2]);
    }
  });

  it("cuts all depths of one pocket before the next", () => {
    const right = rectangle("0d9c8b7a-6f5e-4d3c-ab1a-0f9e8d7c6b5a", 120, 0, 40, 40);
    const left = rectangle("4f8a1c2e-6b3d-4e5f-9a7b-8c9d0e1f2a3b", 0, 0, 40, 40);
    const toolpath = pocket({}, [left, right]);
    const sides = toolpath.moves
      .filter((move) => move.to[2] < 0)
      .map((move) => (move.to[0] < 60 ? "left" : "right"));
    const switches = sides.filter((side, i) => i > 0 && side !== sides[i - 1]);
    expect(switches).toHaveLength(1);
    expect(retracts(toolpath)).toBe(2);
  });

  it("leaves the allowance and finishes the walls at full depth", () => {
    const toolpath = pocket({ allowance: 0.5, finishPass: true }, [square, island]);
    const extent = (z: number) =>
      cutsAt(toolpath, z)
        .flat()
        .reduce((max, [x]) => Math.max(max, x), -Infinity);
    expect(extent(-2)).toBeCloseTo(96.5, 2);
    expect(extent(-4)).toBeCloseTo(96.5, 2);
    expect(extent(-6)).toBeCloseTo(97, 2);
    // The finish laps come last.
    const finishing = cutsAt(toolpath, -6).flat();
    const last = finishing.slice(-4);
    for (const [x, y] of last) {
      const onWall = Math.max(Math.abs(x - 50), Math.abs(y - 50)) > 46.9;
      const onIsland = Math.abs(Math.hypot(x - 50, y - 50) - 13) < 1e-2;
      expect(onWall || onIsland).toBe(true);
    }
    for (const [a, b] of cutsBelowTop(toolpath)) {
      expect(distanceToSegment([50, 50], [a, b])).toBeGreaterThanOrEqual(13 - 1e-2);
    }
  });

  describe("with a neck the clearing rings can't pass", () => {
    // Two 40 mm squares joined by a 7 mm neck: wider than the 6 mm tool, too
    // narrow for rings 1 mm of allowance off both walls.
    const corners: [number, number][] = [
      [40, 0],
      [40, 16.5],
      [60, 16.5],
      [60, 0],
      [100, 0],
      [100, 40],
      [60, 40],
      [60, 23.5],
      [40, 23.5],
      [40, 40],
      [0, 40],
    ];
    const dumbbell: Shape = {
      id: "0d9c8b7a-6f5e-4d3c-ab1a-0f9e8d7c6b5a",
      name: "Dumbbell",
      layer: "0",
      paths: [
        {
          start: [0, 0],
          segments: corners.map((to) => ({ kind: "line" as const, to })),
          closed: true,
        },
      ],
    };
    const toolpath = pocket({ allowance: 1, finishPass: true }, [dumbbell]);

    it("clears the neck in depth passes", () => {
      for (const z of [-2, -4]) {
        const throughNeck = cutsAt(toolpath, z).filter(
          ([a, b]) =>
            Math.min(a[0], b[0]) < 50 && Math.max(a[0], b[0]) > 50 && a[1] > 16 && a[1] < 24,
        );
        expect(throughNeck.length).toBeGreaterThan(0);
      }
      expect(toolpath.warnings).toEqual([]);
    });

    it("finishes the walls only once both sides are cleared", () => {
      // Only the finish lap reaches the outer walls, 3 mm in at x = 3 and x = 97.
      const firstOnWall = toolpath.moves.findIndex(
        (move) => move.to[2] < 0 && (move.to[0] < 3.001 || move.to[0] > 96.999),
      );
      const lastAboveFinalDepth = Math.max(
        ...toolpath.moves.flatMap((move, i) => (move.to[2] < 0 && move.to[2] > -6 ? [i] : [])),
      );
      expect(firstOnWall).toBeGreaterThan(lastAboveFinalDepth);
    });
  });

  it("leaves the allowance on the walls without a finish pass", () => {
    const toolpath = pocket({ allowance: 0.5 });
    for (const cut of cutsBelowTop(toolpath).flat()) {
      for (const value of cut) expect(value).toBeGreaterThanOrEqual(3.5 - 1e-3);
    }
  });

  it("rapids only above the stock, and starts and ends at the retract height", () => {
    const toolpath = pocket({ ramp: true }, [square, island]);
    for (const [from, move] of steps(toolpath)) {
      if (move.kind !== "rapid") continue;
      // Down or up to the entry clearance, or up and across at the retract height.
      if (move.to[2] < from[2]) expect(move.to[2]).toBe(ENTRY_CLEARANCE);
      else expect([ENTRY_CLEARANCE, 5]).toContain(move.to[2]);
    }
    expect(toolpath.moves[0]).toMatchObject({ kind: "rapid" });
    expect(toolpath.moves.at(-1)).toMatchObject({ kind: "rapid" });
  });

  it("plunges straight down at the plunge rate without a ramp", () => {
    for (const [from, move] of steps(pocket({}, [square, island]))) {
      if (move.kind === "feed" && move.to[2] < from[2]) {
        expect(move.to.slice(0, 2)).toEqual(from.slice(0, 2));
        expect(move.feedRate).toBe(tool.plungeRate);
      }
    }
  });

  it("ramps along a ring no steeper than the plunge angle", () => {
    const toolpath = pocket({ ramp: true }, [square, island]);
    let descents = 0;
    for (const [from, move] of steps(toolpath)) {
      if (move.kind !== "feed" || move.to[2] >= from[2] || from[2] > 0) continue;
      descents++;
      const run = Math.hypot(move.to[0] - from[0], move.to[1] - from[1]);
      const angle = (Math.atan2(from[2] - move.to[2], run) * 180) / Math.PI;
      // Down through stock the tool already cleared is straight down.
      if (from[2] < 0 && run === 0) continue;
      expect(angle).toBeLessThanOrEqual(3 + 1e-6);
      expect(move.feedRate).toBe(tool.plungeRate);
    }
    expect(descents).toBeGreaterThan(0);
  });

  it("skips open paths and points with a warning", () => {
    const open: Shape = {
      id: "0d9c8b7a-6f5e-4d3c-ab1a-0f9e8d7c6b5a",
      name: "Groove",
      layer: "0",
      paths: [
        { start: [10, 10], segments: [{ kind: "line", to: [90, 10] }], closed: false },
        { start: [5, 5], segments: [], closed: false },
      ],
    };
    const toolpath = pocket({}, [open]);
    expect(toolpath.moves).toEqual([]);
    expect(toolpath.warnings).toEqual([
      "Skipped 1 point: drill them instead.",
      "Skipped 1 open path: pockets need closed paths.",
    ]);
  });

  it("warns when the pocket is too small for the tool or deeper than the flutes", () => {
    const tiny = rectangle("0d9c8b7a-6f5e-4d3c-ab1a-0f9e8d7c6b5a", 0, 0, 4, 4);
    const toolpath = pocket({ depth: 30 }, [tiny]);
    expect(toolpath.moves).toEqual([]);
    expect(toolpath.warnings).toEqual([
      "The depth exceeds the tool's flute length.",
      "The closed paths are too small for the tool.",
    ]);
  });

  it("is what generateToolpath returns for a pocket", () => {
    expect(generateToolpath({ operation: operation(), shapes: [square], safeZ: 5 })).toEqual(
      pocket(),
    );
  });
});
