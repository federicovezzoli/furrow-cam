import type { PocketOperation, PocketParams, PocketStrategy, Shape, Tool } from "@furrow/document";
import { DRAWING_ID } from "@furrow/document/fixtures";
import { describe, expect, it } from "vitest";
import type { Vec3 } from "../../scene/stock";
import { generateToolpath } from "../generate";
import type { Toolpath, ToolpathMove } from "../toolpath";
import { crossesOnlyInside, pieces } from "./cut";
import { pocketToolpath } from "./pocket";

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
  notes: null,
  color: "#2563eb",
};

const params: PocketParams = {
  side: "inside",
  strategy: { type: "offset" },
  direction: "climb",
  stepOver: 40,
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
    drawingId: DRAWING_ID,
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
  drawingId: DRAWING_ID,
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
  return pocketToolpath(operation(overrides, shapes, toolOverrides), shapes, {
    safeZ: 5,
    entryClearance: 1,
  });
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
    stockSide: "top",
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
  // Each cut filed under every cell `reach` wide it comes within `reach` of.
  const cells = new Map<string, [[number, number], [number, number]][]>();
  for (const cut of cutsAt(toolpath, z)) {
    const [[ax, ay], [bx, by]] = cut;
    for (
      let i = Math.floor(Math.min(ax, bx) / reach) - 1;
      i <= Math.floor(Math.max(ax, bx) / reach) + 1;
      i++
    ) {
      for (
        let j = Math.floor(Math.min(ay, by) / reach) - 1;
        j <= Math.floor(Math.max(ay, by) / reach) + 1;
        j++
      ) {
        const key = `${i},${j}`;
        const cell = cells.get(key) ?? [];
        cell.push(cut);
        cells.set(key, cell);
      }
    }
  }
  const result: [number, number][] = [];
  for (let x = 0; x <= 100; x += spacing) {
    for (let y = 0; y <= 100; y += spacing) {
      const point: [number, number] = [x, y];
      if (!keep(point)) continue;
      const nearby = cells.get(`${Math.floor(x / reach)},${Math.floor(y / reach)}`) ?? [];
      if (nearby.every((cut) => distanceToSegment(point, cut) > reach)) result.push(point);
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

/**
 * Two 40 mm squares joined by a 7 mm neck: wider than the 6 mm tool, too
 * narrow for clearing 1 mm of allowance off both walls.
 */
const dumbbellCorners: [number, number][] = [
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
  drawingId: DRAWING_ID,
  paths: [
    {
      start: [0, 0],
      segments: dumbbellCorners.map((to) => ({ kind: "line" as const, to })),
      closed: true,
    },
  ],
};

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

  it("steps over no more than its step-over", () => {
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
      const toolpath = pocket({ depth: 2, stepOver }, [square, island]);
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

  it("retracts only on the first pass and at the end of a pocket", () => {
    for (const ramp of [false, true]) {
      expect(retracts(pocket({ ramp }))).toBe(1);
      for (const toolpath of [
        pocket({ ramp }, [square, island]),
        pocket({ ramp, allowance: 0.5, finishPass: true }, [square, island]),
      ]) {
        // Below the first pass the stock above is cleared, so the tool stays down.
        const deeper = toolpath.moves.findIndex((move) => move.to[2] < -2 - 1e-9);
        expect(retracts({ ...toolpath, moves: toolpath.moves.slice(deeper) })).toBe(1);
      }
    }
  });

  it("crosses uncut stock at the retract height and cleared stock at its depth", () => {
    // At a zero entry clearance a rapid across the stock top would rub it.
    const toolpath = pocketToolpath(operation({}, [square, island]), [square, island], {
      safeZ: 5,
      entryClearance: 0,
    });
    const across = steps(toolpath).filter(
      ([from, move]) => move.to[0] !== from[0] || move.to[1] !== from[1],
    );
    expect(across.some(([from]) => from[2] === 5)).toBe(true);
    for (const [from, move] of across) {
      if (move.kind === "rapid") expect([from[2], move.to[2]]).toEqual([5, 5]);
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
      if (move.to[2] < from[2]) expect(move.to[2]).toBe(1);
      else expect([1, 5]).toContain(move.to[2]);
    }
    expect(toolpath.moves[0]).toMatchObject({ kind: "rapid" });
    expect(toolpath.moves.at(-1)).toMatchObject({ kind: "rapid" });
  });

  it("rapids down to the machine's entry clearance", () => {
    for (const entryClearance of [0, 2.5]) {
      const toolpath = pocketToolpath(operation(), [square], { safeZ: 5, entryClearance });
      const downs = steps(toolpath).filter(
        ([from, move]) => move.kind === "rapid" && move.to[2] < from[2],
      );
      expect(downs.length).toBeGreaterThan(0);
      for (const [, move] of downs) expect(move.to[2]).toBe(entryClearance);
    }
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
      drawingId: DRAWING_ID,
      paths: [
        { start: [10, 10], segments: [{ kind: "line", to: [90, 10] }], closed: false },
        { start: [5, 5], segments: [], closed: false },
      ],
    };
    const toolpath = pocket({}, [open]);
    expect(toolpath.moves).toEqual([]);
    expect(toolpath.warnings).toEqual([
      { code: "toolpath.skippedPoints", values: { count: 1 } },
      { code: "toolpath.skippedOpenPocket", values: { count: 1 } },
    ]);
  });

  it("warns when the pocket is too small for the tool or deeper than the flutes", () => {
    const tiny = rectangle("0d9c8b7a-6f5e-4d3c-ab1a-0f9e8d7c6b5a", 0, 0, 4, 4);
    const toolpath = pocket({ depth: 30 }, [tiny]);
    expect(toolpath.moves).toEqual([]);
    expect(toolpath.warnings).toEqual([
      { code: "toolpath.depthExceedsFlutes" },
      { code: "toolpath.pathsTooSmall" },
    ]);
  });

  it("is what generateToolpath returns for a pocket", () => {
    expect(
      generateToolpath({
        operation: operation(),
        shapes: [square],
        model: null,
        stock: null,
        stockBottom: null,
        parting: null,
        flip: null,
        before: [],
        touchOff: null,
        safeZ: 5,
        entryClearance: 1,
      }),
    ).toEqual(pocket());
  });
});

const STRATEGIES: PocketStrategy[] = [
  { type: "linear", angle: 0 },
  { type: "linear", angle: 90 },
  { type: "linear", angle: 45 },
  { type: "linear", angle: -45 },
  { type: "peel", start: "centre" },
  { type: "peel", start: "inside" },
  { type: "peel", start: "outside" },
];

/** Distance from the lap around the square's walls, 3 mm in. */
const offWallLap = ([x, y]: [number, number]) =>
  Math.abs(Math.max(Math.abs(x - 50), Math.abs(y - 50)) - 47);
/** Distance from the lap around the island, 3 mm out. */
const offIslandLap = ([x, y]: [number, number]) => Math.abs(Math.hypot(x - 50, y - 50) - 13);
const onLap = (point: [number, number]) => Math.min(offWallLap(point), offIslandLap(point)) < 1e-2;

/** Moves that go down, as `[from, to]`. */
function descents(toolpath: Toolpath): [Vec3, Vec3][] {
  return steps(toolpath)
    .filter(([from, move]) => move.kind === "feed" && move.to[2] < from[2] - 1e-9)
    .map(([from, move]) => [from, move.to]);
}

describe.each(STRATEGIES.map((strategy) => [Object.values(strategy).join(" "), strategy] as const))(
  "pocketToolpath with %s clearing",
  (_, strategy) => {
    const clear = (overrides: Partial<PocketParams> = {}, shapes = [square, island], tools = {}) =>
      pocket({ strategy, ...overrides }, shapes, tools);

    it("clears around the island at every depth without cutting it", () => {
      const toolpath = clear();
      for (const z of [-2, -4, -6]) {
        expect(missed(toolpath, z, 3 + 1e-2, (p) => inSquare(p) && offIsland(p))).toEqual([]);
      }
      for (const cut of cutsBelowTop(toolpath)) {
        expect(distanceToSegment([50, 50], cut)).toBeGreaterThanOrEqual(13 - 1e-2);
        for (const value of cut.flat()) {
          expect(value).toBeGreaterThanOrEqual(3 - 1e-3);
          expect(value).toBeLessThanOrEqual(97 + 1e-3);
        }
      }
      expect(toolpath.warnings).toEqual([]);
    });

    it("clears with a step-over over half the diameter", () => {
      for (const stepOver of [60, 100]) {
        const toolpath = clear({ depth: 2, stepOver }, [square, island]);
        expect(missed(toolpath, -2, 3 + 1e-2, (p) => inSquare(p) && offIsland(p), 0.5)).toEqual([]);
        for (const cut of cutsBelowTop(toolpath)) {
          expect(distanceToSegment([50, 50], cut)).toBeGreaterThanOrEqual(13 - 1e-2);
        }
      }
    });

    it.skipIf(strategy.type === "peel" && strategy.start === "inside")(
      "moves at depth over what it has cut rather than retracting",
      () => {
        expect(retracts(clear({}, [square]))).toBe(1);
      },
    );

    it("leaves the allowance and finishes the walls at full depth", () => {
      const toolpath = clear({ allowance: 0.5, finishPass: true });
      const extent = (z: number) =>
        cutsAt(toolpath, z)
          .flat()
          .reduce((max, [x]) => Math.max(max, x), -Infinity);
      expect(extent(-2)).toBeCloseTo(96.5, 2);
      expect(extent(-4)).toBeCloseTo(96.5, 2);
      expect(extent(-6)).toBeCloseTo(97, 2);
      const last = cutsAt(toolpath, -6).flat().slice(-4);
      for (const point of last) expect(onLap(point)).toBe(true);
      expect(clear({ allowance: 0.5 }).warnings).toEqual([]);
      for (const value of cutsBelowTop(clear({ allowance: 0.5 })).flat(2)) {
        expect(value).toBeGreaterThanOrEqual(3.5 - 1e-3);
      }
    });

    it("climbs counter-clockwise along the walls and clockwise around islands", () => {
      // Linear passes, and the moves along the laps between them, go both
      // ways; its laps, cut first, carry the direction.
      const directed = (toolpath: Toolpath) => {
        const cuts = cutsAt(toolpath, -6);
        if (strategy.type !== "linear") return cuts;
        // Both laps: 4 × 94 mm and a little under 2π × 13 mm.
        let length = 0;
        return cuts.filter(([a, b]) => {
          length += Math.hypot(b[0] - a[0], b[1] - a[1]);
          return length <= 4 * 94 + 81;
        });
      };
      const rising = (toolpath: Toolpath) =>
        directed(toolpath)
          .filter(([a, b]) => Math.abs(a[0] - 97) < 1e-3 && Math.abs(b[0] - 97) < 1e-3)
          .map(([a, b]) => Math.sign(b[1] - a[1]));
      expect(rising(clear())).toContain(1);
      expect(rising(clear())).not.toContain(-1);
      expect(rising(clear({ direction: "conventional" }))).not.toContain(1);
      const aroundIsland = directed(clear()).filter(
        ([a, b]) => offIslandLap(a) < 1e-2 && offIslandLap(b) < 1e-2 && a[0] > 62,
      );
      expect(aroundIsland.length).toBeGreaterThan(0);
      for (const [a, b] of aroundIsland) expect(b[1]).toBeLessThanOrEqual(a[1] + 1e-9);
    });

    it("rapids only above the stock and retracts only on the first pass and at the end", () => {
      const toolpath = clear(
        { ramp: true },
        strategy.type === "peel" ? [square, island] : [square],
      );
      for (const [from, move] of steps(toolpath)) {
        if (move.kind !== "rapid") continue;
        if (move.to[2] < from[2]) expect(move.to[2]).toBe(1);
        else expect([1, 5]).toContain(move.to[2]);
      }
      if (strategy.type === "linear" || (strategy.type === "peel" && strategy.start === "inside")) {
        const deeper = toolpath.moves.findIndex((move) => move.to[2] < -2 - 1e-9);
        expect(retracts({ ...toolpath, moves: toolpath.moves.slice(deeper) })).toBe(1);
      }
    });

    it("plunges straight down at the plunge rate without a ramp", () => {
      for (const [from, move] of steps(clear())) {
        if (move.kind === "feed" && move.to[2] < from[2]) {
          expect(Math.hypot(move.to[0] - from[0], move.to[1] - from[1])).toBeLessThan(1e-9);
          expect(move.feedRate).toBe(tool.plungeRate);
        }
      }
    });

    it("ramps no steeper than the plunge angle into uncut stock", () => {
      const toolpath = clear({ ramp: true });
      const cutAt = new Map<number, [[number, number], [number, number]][]>();
      let ramps = 0;
      for (const [from, move] of steps(toolpath)) {
        const { to } = move;
        if (move.kind === "feed" && from[2] === to[2]) {
          const cuts = cutAt.get(to[2]) ?? [];
          cuts.push([
            [from[0], from[1]],
            [to[0], to[1]],
          ]);
          cutAt.set(to[2], cuts);
        }
        if (move.kind !== "feed" || to[2] >= from[2] || from[2] > 0) continue;
        const run = Math.hypot(to[0] - from[0], to[1] - from[1]);
        if (run < 1e-9) {
          // Straight down only onto what the tool has cut at that depth, give
          // or take the chord tolerance.
          const landed = cutAt.get(to[2]) ?? [];
          expect(landed.some((cut) => distanceToSegment([to[0], to[1]], cut) < 2e-2)).toBe(true);
        } else {
          ramps++;
          expect((Math.atan2(from[2] - to[2], run) * 180) / Math.PI).toBeLessThanOrEqual(3 + 1e-6);
        }
      }
      expect(ramps).toBeGreaterThan(0);
    });

    it.skipIf(strategy.type === "peel" && strategy.start === "inside")(
      "clears necks the clearing can't pass in depth passes",
      () => {
        const toolpath = clear({ allowance: 1, finishPass: true }, [dumbbell]);
        for (const z of [-2, -4]) {
          const throughNeck = cutsAt(toolpath, z).filter(
            ([a, b]) =>
              Math.min(a[0], b[0]) < 50 && Math.max(a[0], b[0]) > 50 && a[1] > 16 && a[1] < 24,
          );
          expect(throughNeck.length).toBeGreaterThan(0);
        }
        expect(toolpath.warnings).toEqual([]);
      },
    );
  },
);

describe("pocketToolpath with linear clearing", () => {
  const linear = (
    angle: 0 | 90 | 45 | -45,
    overrides: Partial<PocketParams> = {},
    shapes = [square, island],
  ) => pocket({ strategy: { type: "linear", angle }, ...overrides }, shapes);

  it("cuts the laps around the walls and the island first on each level", () => {
    const toolpath = linear(0);
    for (const z of [-2, -4, -6]) {
      const cuts = cutsAt(toolpath, z);
      const firstPass = cuts.findIndex(([a, b]) => !onLap([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]));
      const laps = cuts.slice(0, firstPass);
      // Every point of both laps, every millimetre.
      for (let t = 0; t < 1; t += 1 / 376) {
        const along = t * 376;
        const side = Math.floor(along / 94);
        const d = along % 94;
        const point: [number, number] = [
          [3 + d, 97, 97 - d, 3][side] as number,
          [3, 3 + d, 97, 97 - d][side] as number,
        ];
        expect(laps.some((cut) => distanceToSegment(point, cut) < 1e-2)).toBe(true);
      }
      for (let angle = 0; angle < 360; angle += 5) {
        const radians = (angle * Math.PI) / 180;
        const point: [number, number] = [50 + 13 * Math.cos(radians), 50 + 13 * Math.sin(radians)];
        expect(laps.some((cut) => distanceToSegment(point, cut) < 2e-2)).toBe(true);
      }
    }
  });

  it("cuts passes at the angle, one step-over apart, alternating direction", () => {
    for (const angle of [0, 90, 45, -45] as const) {
      const radians = (angle * Math.PI) / 180;
      const direction: [number, number] = [Math.cos(radians), Math.sin(radians)];
      const across = ([x, y]: [number, number]) => y * direction[0] - x * direction[1];
      const passes = cutsAt(linear(angle, {}, [square]), -6).filter(
        ([a, b]) => offWallLap([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]) > 1e-2,
      );
      expect(passes.length).toBeGreaterThan(20);
      const lines = new Set<number>();
      let alternations = 0;
      passes.forEach(([a, b], i) => {
        const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const dot = ((b[0] - a[0]) * direction[0] + (b[1] - a[1]) * direction[1]) / length;
        expect(Math.abs(dot)).toBeCloseTo(1, 6);
        lines.add(Math.round(across(a) * 1000));
        const previous = passes[i - 1];
        // Consecutive passes on neighbouring lines go opposite ways.
        if (previous && Math.abs(Math.abs(across(a) - across(previous[0])) - 2.4) < 1e-6) {
          const previousDot =
            (previous[1][0] - previous[0][0]) * direction[0] +
            (previous[1][1] - previous[0][1]) * direction[1];
          expect(Math.sign(previousDot)).toBe(-Math.sign(dot));
          alternations++;
        }
      });
      expect(alternations).toBeGreaterThan(10);
      const positions = [...lines].sort((a, b) => a - b).map((line) => line / 1000);
      for (let i = 1; i < positions.length; i++) {
        expect((positions[i] as number) - (positions[i - 1] as number)).toBeCloseTo(2.4, 6);
      }
    }
  });

  it("starts and ends every pass on the lap, entering at depth", () => {
    for (const ramp of [false, true]) {
      const toolpath = linear(45, { ramp });
      for (const [a, b] of cutsAt(toolpath, -4)) {
        if (onLap([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2])) continue;
        expect(onLap(a)).toBe(true);
        expect(onLap(b)).toBe(true);
      }
      // Every descent below the stock top lands on a lap.
      for (const [from, to] of descents(toolpath)) {
        if (from[2] <= 0) expect(onLap([to[0], to[1]])).toBe(true);
      }
    }
  });
});

describe("pocketToolpath with peel clearing", () => {
  const peel = (
    start: "centre" | "inside" | "outside",
    overrides: Partial<PocketParams> = {},
    shapes = [square, island],
    toolOverrides: Partial<Tool> = {},
  ) => pocket({ strategy: { type: "peel", start }, ...overrides }, shapes, toolOverrides);

  /**
   * How far from the cuts before it at `z` the tool centre gets, the cuts
   * `starting` holds for left out: how wide it cuts sideways.
   */
  function widestCut(
    toolpath: Toolpath,
    z: number,
    starting: (point: [number, number]) => boolean,
  ): number {
    const cuts = cutsAt(toolpath, z);
    let widest = 0;
    cuts.forEach(([a, b], i) => {
      for (const t of [0.25, 0.5, 0.75, 1]) {
        const point: [number, number] = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        if (starting(point)) continue;
        let nearest = Infinity;
        for (let j = 0; j < i; j++) {
          nearest = Math.min(
            nearest,
            distanceToSegment(point, cuts[j] as [[number, number], [number, number]]),
          );
        }
        // Along a cut, its own start.
        nearest = Math.min(
          nearest,
          Math.hypot(point[0] - a[0], point[1] - a[1]) * (i === 0 ? Infinity : 1),
        );
        widest = Math.max(widest, nearest);
      }
    });
    return widest;
  }

  it("never cuts wider than the step-over after the starting cut", () => {
    const starts = {
      centre: (shapes: Shape[]) =>
        shapes.length === 1
          ? ([x, y]: [number, number]) => Math.hypot(x - 50, y - 50) <= 2.4 + 1e-2
          : () => false,
      inside: () => (point: [number, number]) => offIslandLap(point) < 1e-2,
      outside: () => (point: [number, number]) => offWallLap(point) < 1e-2,
    };
    for (const [start, shapes] of [
      ["centre", [square]],
      ["inside", [square, island]],
      ["outside", [square, island]],
    ] as const) {
      const toolpath = peel(start, { depth: 2 }, [...shapes]);
      // The step-over, give or take the chord tolerance the fronts are drawn to.
      expect(widestCut(toolpath, -2, starts[start]([...shapes]))).toBeLessThanOrEqual(2.4 + 2e-2);
    }
  });

  it("enters the centre with a helix one step-over around the point furthest from the walls", () => {
    /** The moves down to each level, from the depth the last one cleared. */
    const entries = (toolpath: Toolpath) =>
      [-2, -4, -6].map((z) => {
        const { moves } = toolpath;
        let i = moves.findIndex((move) => move.to[2] === z);
        const entry: ToolpathMove[] = [];
        // Back to the move that got to the depth the last level cleared.
        while (i > 0) {
          entry.unshift(moves[i] as ToolpathMove);
          if ((moves[i - 1] as ToolpathMove).to[2] >= z + 2 - 1e-9) break;
          i--;
        }
        return entry;
      });
    const onCircle = ([x, y]: Vec3) => Math.abs(Math.hypot(x - 50, y - 50) - 2.4) < 1e-2;
    // Ramping: around the circle, given or taken the chord tolerance it is drawn to.
    for (const entry of entries(peel("centre", { ramp: true }, [square]))) {
      expect(entry.length).toBeGreaterThan(1);
      for (const move of entry) expect(onCircle(move.to)).toBe(true);
    }
    // Without a ramp, a straight plunge onto the circle.
    for (const entry of entries(peel("centre", {}, [square]))) {
      expect(entry).toHaveLength(1);
      expect(onCircle((entry[0] as ToolpathMove).to)).toBe(true);
    }
  });

  it("crosses the core a helix wider than the tool leaves", () => {
    const toolpath = peel("centre", { stepOver: 90 }, [square]);
    for (const z of [-2, -4, -6]) {
      // Through the point furthest from the helix, give or take the tolerance.
      expect(cutsAt(toolpath, z).some((cut) => distanceToSegment([50, 50], cut) < 1e-2)).toBe(true);
    }
  });

  it("ramps along the first pass where the helix doesn't fit", () => {
    // 4 mm of tool centre across: less than the 4.8 mm helix.
    const slot = rectangle("0d9c8b7a-6f5e-4d3c-ab1a-0f9e8d7c6b5a", 0, 0, 100, 10);
    const toolpath = peel("centre", { ramp: true }, [slot]);
    const inSlot = ([x, y]: [number, number]) =>
      inSquare([x, y]) &&
      y < 10 &&
      Math.hypot(Math.max(0, 3 - x, x - 97), Math.max(0, 3 - y, y - 7)) <= 3;
    expect(missed(toolpath, -6, 3 + 1e-2, inSlot, 0.5)).toEqual([]);
    expect(toolpath.warnings).toEqual([]);
    const first = descents(toolpath).filter(([from]) => from[2] <= 0);
    for (const [, to] of first) {
      expect(to[1]).toBeGreaterThanOrEqual(3 - 1e-3);
      expect(to[1]).toBeLessThanOrEqual(7 + 1e-3);
    }
  });

  it("starts along the island or the outer wall", () => {
    for (const [start, lap] of [
      ["inside", offIslandLap],
      ["outside", offWallLap],
    ] as const) {
      const toolpath = peel(start);
      for (const z of [-2, -4, -6]) {
        const [first] = cutsAt(toolpath, z);
        if (!first) throw new Error("No cuts");
        expect(lap(first[0])).toBeLessThan(1e-2);
        expect(lap(first[1])).toBeLessThan(1e-2);
      }
    }
  });

  it("needs exactly one island per pocket to start from it", () => {
    const warning = { code: "toolpath.peelIsland" };
    const second: Shape = {
      ...rectangle("0d9c8b7a-6f5e-4d3c-ab1a-0f9e8d7c6b5a", 10, 10, 10, 10),
    };
    for (const shapes of [[square], [square, island, second]]) {
      expect(peel("inside", {}, shapes)).toEqual({ moves: [], warnings: [warning] });
    }
    // Only the pocket with one island is cleared, with one warning for the other.
    const other = rectangle("5e4d3c2b-1a0f-4e9d-8c7b-6a5f4e3d2c1b", 120, 0, 40, 40);
    const toolpath = peel("inside", {}, [square, island, other]);
    expect(toolpath.warnings).toEqual([warning]);
    expect(toolpath.moves.length).toBeGreaterThan(0);
    for (const move of toolpath.moves) expect(move.to[0]).toBeLessThanOrEqual(100);
  });
});

/**
 * The 100 mm square with 2 mm wide tabs of material sticking 10 mm in from
 * each wall, off-centre, so a move along a wall's offset line passes a tab's
 * junction vertices exactly and none of a few evenly spaced points lands in it.
 */
const tabs: [number, number, number, number][] = [
  [59, 0, 61, 10],
  [90, 37, 100, 39],
  [37, 90, 39, 100],
  [0, 63, 10, 65],
];
const tabbed: Shape = {
  id: "7c6b5a4f-3e2d-4c1b-8a9f-0e1d2c3b4a5f",
  name: "Tabbed square",
  layer: "0",
  drawingId: DRAWING_ID,
  paths: [
    {
      start: [0, 0],
      segments: (
        [
          [59, 0],
          [59, 10],
          [61, 10],
          [61, 0],
          [100, 0],
          [100, 37],
          [90, 37],
          [90, 39],
          [100, 39],
          [100, 100],
          [39, 100],
          [39, 90],
          [37, 90],
          [37, 100],
          [0, 100],
          [0, 65],
          [10, 65],
          [10, 63],
          [0, 63],
        ] as [number, number][]
      ).map((to) => ({ kind: "line" as const, to })),
      closed: true,
    },
  ],
};

describe("pocketToolpath with tabs sticking in from the walls", () => {
  it("knows a move along a wall line through a tab's junction vertices leaves the area", () => {
    // The tab at x 59 to 61 grown by the tool radius: junction vertices on y = 3.
    const ring: [number, number][] = [
      [3, 3],
      [56, 3],
      [56, 13],
      [64, 13],
      [64, 3],
      [97, 3],
      [97, 97],
      [3, 97],
    ];
    const layout = { stepOver: 2.4, radius: 3, reverse: false, tolerance: 1e-3 };
    const [piece] = pieces([ring], layout);
    if (!piece) throw new Error("No piece");
    expect(crossesOnlyInside(piece, [3, 3], [97, 3])).toBe(false);
    expect(crossesOnlyInside(piece, [10, 3], [90, 3])).toBe(false);
    // Along the wall up to the tab, and across the area: inside.
    expect(crossesOnlyInside(piece, [3, 3], [56, 3])).toBe(true);
    expect(crossesOnlyInside(piece, [10, 3], [10, 90])).toBe(true);
    expect(crossesOnlyInside(piece, [56, 13], [90, 50])).toBe(true);
  });

  for (const strategy of [
    { type: "offset" },
    { type: "linear", angle: 0 },
    { type: "linear", angle: 90 },
    { type: "peel", start: "centre" },
    { type: "peel", start: "outside" },
  ] as PocketStrategy[]) {
    it(`never cuts into a tab with ${JSON.stringify(strategy)} clearing`, () => {
      const toolpath = pocket({ strategy }, [tabbed]);
      expect(toolpath.moves.length).toBeGreaterThan(0);
      let closest = Infinity;
      for (const [a, b] of cutsBelowTop(toolpath)) {
        const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
        for (let d = 0; d <= length; d += 0.05) {
          const t = length > 0 ? d / length : 0;
          const x = a[0] + (b[0] - a[0]) * t;
          const y = a[1] + (b[1] - a[1]) * t;
          for (const [x0, y0, x1, y1] of tabs) {
            const gap = Math.hypot(Math.max(0, x0 - x, x - x1), Math.max(0, y0 - y, y - y1));
            closest = Math.min(closest, gap);
          }
        }
      }
      // Within the arc tolerance of the radius around the tabs' corners.
      expect(closest).toBeGreaterThan(3 - 2e-2);
    });
  }
});

describe.each(
  [{ type: "offset" } as const, ...STRATEGIES].map(
    (strategy) => [Object.values(strategy).join(" "), strategy] as const,
  ),
)("pocketToolpath on the side of the paths with %s clearing (#386)", (_, strategy) => {
  /** 20 × 20 mm in the middle of the 100 × 100 mm stock. */
  const boss = rectangle("6c5b4a3f-2e1d-4c0b-9a8f-7e6d5c4b3a2f", 40, 40, 20, 20);
  const stock = { min: [0, 0], max: [100, 100] } as const;
  const offBoss = ([x, y]: [number, number]) =>
    Math.hypot(Math.max(0, 40 - x, x - 60), Math.max(0, 40 - y, y - 60));
  const clear = (overrides: Partial<PocketParams>, shapes = [boss]) =>
    pocketToolpath(
      operation({ strategy, ...overrides }, shapes),
      shapes,
      {
        safeZ: 5,
        entryClearance: 1,
      },
      { min: [...stock.min], max: [...stock.max] },
    );
  /** Points along `cut` no more than half a millimetre apart. */
  const along = ([a, b]: [[number, number], [number, number]]) => {
    const count = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.5);
    return Array.from({ length: count + 1 }, (_, i): [number, number] => [
      a[0] + ((b[0] - a[0]) * i) / Math.max(count, 1),
      a[1] + ((b[1] - a[1]) * i) / Math.max(count, 1),
    ]);
  };
  const extremes = (toolpath: Toolpath) => {
    const values = cutsAt(toolpath, -6).flat(2);
    return [Math.min(...values), Math.max(...values)];
  };
  // Peeling from the island skips pockets without one.
  const islandless = it.skipIf(strategy.type === "peel" && strategy.start === "inside");

  it("clears the stock outside the paths to its edge, leaving the shape standing", () => {
    const toolpath = clear({ side: "outside" });
    expect(missed(toolpath, -6, 3 + 1e-2, (p) => offBoss(p) > 0.5)).toEqual([]);
    for (const cut of cutsBelowTop(toolpath)) {
      for (const point of along(cut)) expect(offBoss(point)).toBeGreaterThan(3 - 2e-2);
    }
    const [min, max] = extremes(toolpath);
    expect(min).toBeCloseTo(0, 3);
    expect(max).toBeCloseTo(100, 3);
  });

  islandless("cuts a hole in the shape as a pocket when clearing outside", () => {
    const toolpath = clear({ side: "outside" }, [square, island]);
    expect(cutsAt(toolpath, -6).some((cut) => distanceToSegment([50, 50], cut) < 7)).toBe(true);
  });

  it("leaves the allowance and finishes only the shape's walls when clearing outside", () => {
    const toolpath = clear({ side: "outside", allowance: 0.5, finishPass: true });
    let closest = Infinity;
    for (const cut of cutsBelowTop(toolpath)) {
      for (const point of along(cut)) closest = Math.min(closest, offBoss(point));
    }
    expect(closest).toBeCloseTo(3, 1);
    // The stock edge is cleared once, with no lap around it in the air.
    const [min, max] = extremes(toolpath);
    expect(min).toBeCloseTo(0, 3);
    expect(max).toBeCloseTo(100, 3);
  });

  islandless("finishes the walls of a shape that spans the stock when clearing outside", () => {
    // From off one side of the stock to off the other: no lap corner lands on the stock.
    const band = rectangle("1e2d3c4b-5a69-4788-97a6-b5c4d3e2f1a0", -10, 40, 120, 20);
    const offBand = ([, y]: [number, number]) => Math.max(0, 40 - y, y - 60);
    const toolpath = clear({ side: "outside", allowance: 0.5, finishPass: true }, [band]);
    let closest = Infinity;
    for (const cut of cutsBelowTop(toolpath)) {
      for (const point of along(cut)) closest = Math.min(closest, offBand(point));
    }
    expect(closest).toBeCloseTo(3, 1);
  });

  it("warns when the paths leave no stock outside them", () => {
    const cover = rectangle("2f3e4d5c-6b7a-4899-a8b7-c6d5e4f3a2b1", 0, 0, 100, 100);
    const toolpath = clear({ side: "outside" }, [cover]);
    expect(toolpath.moves).toEqual([]);
    expect(toolpath.warnings).toEqual([{ code: "toolpath.nothingOutside" }]);
    const unknown = pocketToolpath(operation({ strategy, side: "outside" }, [boss]), [boss], {
      safeZ: 5,
      entryClearance: 1,
    });
    expect(unknown.warnings).toEqual([{ code: "toolpath.nothingOutside" }]);
  });

  islandless("overcuts the paths by the tool radius when clearing on them", () => {
    const toolpath = clear({ side: "on" });
    expect(extremes(toolpath)).toEqual([expect.closeTo(40, 2), expect.closeTo(60, 2)]);
    const finished = clear({ side: "on", allowance: 0.5, finishPass: true });
    expect(extremes(finished)).toEqual([expect.closeTo(40, 2), expect.closeTo(60, 2)]);
  });

  islandless("keeps the tool radius inside the paths when clearing inside", () => {
    expect(extremes(clear({ side: "inside" }))).toEqual([
      expect.closeTo(43, 2),
      expect.closeTo(57, 2),
    ]);
  });
});
