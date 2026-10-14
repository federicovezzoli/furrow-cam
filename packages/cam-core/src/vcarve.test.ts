import type { Path, Point, Shape, Tool, VCarveOperation, VCarveParams } from "@furrow/document";
import { endMill, vBit } from "@furrow/document/fixtures";
import { describe, expect, it } from "vitest";
import { generateToolpath } from "./generate";
import { distanceToSegment } from "./passes";
import type { Vec3 } from "./stock";
import type { Toolpath, ToolpathMove } from "./toolpath";
import { simplify3d, vcarveToolpath } from "./vcarve";

/** 90°, so the depth equals the distance to the nearest edge; 30 mm wide, so its cone is 15 mm deep. */
const bit: Tool = { ...vBit, vAngle: 90, diameter: 30, stepDown: 2 };

const options = { safeZ: 5, entryClearance: 1 };

function rectangle(x: number, y: number, width: number, height: number, clockwise = false): Path {
  const corners: Point[] = [
    [x + width, y],
    [x + width, y + height],
    [x, y + height],
  ];
  if (clockwise) corners.reverse();
  return {
    start: [x, y],
    segments: corners.map((to) => ({ kind: "line", to })),
    closed: true,
  };
}

function shape(...paths: Path[]): Shape {
  return { id: "4f8a1c2e-6b3d-4e5f-9a7b-8c9d0e1f2a3b", name: "Shape", layer: "0", paths };
}

/** 100 × 20 mm: its axis is the centre line at 10 mm from the long edges. */
const bar = shape(rectangle(0, 0, 100, 20));

/** A 40 mm square with a 20 mm square island: an O with square corners, 10 mm wide all round. */
const ring = shape(rectangle(0, 0, 40, 40), rectangle(10, 10, 20, 20));

/**
 * The deepest point of `ring`, between an outer corner and the island's: on
 * the diagonal at (t, t), t mm from the outer edges and √2 (10 − t) from the
 * island's corner.
 */
const OUTER_TO_ISLAND_CORNER = (-10 * Math.SQRT2) / (1 + Math.SQRT2);

function vcarve(params: Partial<VCarveParams> = {}, tool = bit): VCarveOperation {
  return {
    id: "6b1f3c2a-8d4e-4f5a-9b6c-7d8e9f0a1b2c",
    name: "V-carve",
    enabled: true,
    targets: [],
    tool,
    type: "vcarve",
    params: { maxDepth: 10, flatBottom: null, ...params },
  };
}

function carve(params: Partial<VCarveParams> = {}, shapes = [bar], tool = bit): Toolpath {
  return vcarveToolpath(vcarve(params, tool), shapes, options);
}

/** The ends of the feed moves that cut into the stock. */
function cuts(moves: ToolpathMove[]): Vec3[] {
  return moves.filter((move) => move.kind === "feed" && move.to[2] < 0).map((move) => move.to);
}

/** The depths of the flat feeds along y = `y` that cross x = 50. */
function levelsAcross(moves: ToolpathMove[], y: number): number[] {
  const levels = new Set<number>();
  moves.forEach((move, i) => {
    const from = moves[i - 1]?.to;
    if (move.kind !== "feed" || !from) return;
    const [x, y1, z] = move.to;
    const along = Math.abs(from[1] - y) < 0.02 && Math.abs(y1 - y) < 0.02;
    if (along && Math.abs(from[2] - z) < 1e-6 && (from[0] - 50) * (x - 50) < 0) {
      levels.add(Math.round(z * 1000) / 1000);
    }
  });
  return [...levels].sort((a, b) => b - a);
}

function deepest(moves: ToolpathMove[]): number {
  return Math.min(...moves.map((move) => move.to[2]));
}

/** Distance from `point` to the nearest edge of the closed `rings`. */
function edgeDistance(point: Point, rings: Point[][]): number {
  let best = Infinity;
  for (const ring of rings) {
    ring.forEach((a, i) => {
      best = Math.min(best, distanceToSegment(point, a, ring[(i + 1) % ring.length] as Point));
    });
  }
  return best;
}

const barRings: Point[][] = [
  [
    [0, 0],
    [100, 0],
    [100, 20],
    [0, 20],
  ],
];

describe("vcarveToolpath", () => {
  it("follows the medial axis as deep as the edges are far, never past them", () => {
    const { moves, warnings } = carve();
    expect(warnings).toEqual([]);
    expect(deepest(moves)).toBeCloseTo(-10, 3);
    const points = cuts(moves);
    expect(points.length).toBeGreaterThan(0);
    for (const [x, y, z] of points) {
      // A 90° bit cuts as wide as twice its depth: no deeper than the edge is far.
      expect(-z).toBeLessThanOrEqual(edgeDistance([x, y], barRings) + 1e-3);
    }
    // The centre line, at full depth.
    expect(levelsAcross(moves, 10).at(-1)).toBe(-10);
  });

  it("carves into the corners", () => {
    const { moves } = carve();
    const corners: Point[] = [
      [0, 0],
      [100, 0],
      [100, 20],
      [0, 20],
    ];
    const reached = moves.filter((move) => move.kind === "feed").map((move) => move.to);
    for (const [cx, cy] of corners) {
      expect(reached.some(([x, y]) => Math.hypot(x - cx, y - cy) < 0.01)).toBe(true);
    }
  });

  it("starts and ends at the retract height", () => {
    const { moves } = carve();
    expect(moves[0]).toMatchObject({ kind: "rapid" });
    expect(moves[0]?.to[2]).toBe(5);
    expect(moves.at(-1)).toMatchObject({ kind: "rapid" });
    expect(moves.at(-1)?.to[2]).toBe(5);
  });

  it("cuts in passes no deeper than the step-down, each only where the last fell short", () => {
    const { moves } = carve();
    expect(levelsAcross(moves, 10)).toEqual([-2, -4, -6, -8, -10]);
    // Every move goes down at most a step-down below what the passes before cut.
    let previous: Vec3 | null = null;
    for (const move of moves) {
      if (move.kind === "feed" && previous) {
        expect(Math.min(previous[2], 0) - move.to[2]).toBeLessThanOrEqual(2 + 1e-6);
      }
      previous = move.to;
    }
  });

  it("carves in one pass when the step-down allows", () => {
    const shallow = carve({}, [bar], { ...bit, stepDown: 15 });
    expect(levelsAcross(shallow.moves, 10)).toEqual([-10]);
  });

  it("stops at the maximum depth and warns about the edges it leaves", () => {
    const { moves, warnings } = carve({ maxDepth: 4 });
    expect(deepest(moves)).toBeCloseTo(-4, 6);
    expect(warnings).toEqual([
      "Parts are wider than the V-bit reaches at the maximum depth, so their edges stay " +
        "uncarved: turn on a flat bottom to clear them.",
    ]);
    expect(carve({ maxDepth: 10 }).warnings).toEqual([]);
  });

  it("stops at the cone and says so", () => {
    const small = { ...bit, diameter: 12 };
    const { moves, warnings } = carve({}, [bar], small);
    expect(carve({ maxDepth: 15 }).warnings).toEqual([]);
    expect(deepest(moves)).toBeCloseTo(-6, 6);
    expect(warnings).toContain(
      "The maximum depth exceeds the V-bit's cone, so it carves no deeper than that.",
    );
  });

  it("with a flat bottom, carves the walls at the limit and clears the floor with the end mill", () => {
    const { moves, clearing, warnings } = carve({ maxDepth: 4, flatBottom: { tool: endMill } });
    expect(warnings).toEqual([]);
    expect(deepest(moves)).toBeCloseTo(-4, 6);
    for (const [x, y, z] of cuts(moves)) {
      // The V-bit stays where it reaches the edges: within 4 mm of them.
      expect(edgeDistance([x, y], barRings)).toBeLessThanOrEqual(4 + 0.02);
      expect(-z).toBeLessThanOrEqual(edgeDistance([x, y], barRings) + 1e-3);
    }
    // The wall along the bottom edge, 4 mm in, at the limit.
    expect(levelsAcross(moves, 4)).toEqual([-2, -4]);

    expect(clearing).toBeDefined();
    const floor = clearing as ToolpathMove[];
    expect(deepest(floor)).toBeCloseTo(-4, 6);
    expect(floor[0]?.kind).toBe("rapid");
    expect(floor.at(-1)?.to[2]).toBe(5);
    // The end mill stays its radius inside the walls, 4 mm in.
    for (const [x, y] of cuts(floor)) {
      expect(edgeDistance([x, y], barRings)).toBeGreaterThanOrEqual(
        4 + endMill.diameter / 2 - 0.02,
      );
    }
  });

  it("has no clearing moves without a flat bottom", () => {
    expect(carve()).not.toHaveProperty("clearing");
  });

  it("warns when the floor is too narrow for the flat-bottom tool", () => {
    // 20 mm wide, the walls 8 mm in: a 4 mm floor for a 6.35 mm end mill.
    const { warnings, clearing } = carve({ maxDepth: 8, flatBottom: { tool: endMill } });
    expect(warnings).toEqual([
      "Some flat areas are too narrow for the flat-bottom tool and stay uncut.",
    ]);
    expect(clearing).toEqual([]);
  });

  it("leaves islands standing", () => {
    const { moves, warnings } = carve({}, [ring]);
    expect(warnings).toEqual([]);
    expect(deepest(moves)).toBeCloseTo(OUTER_TO_ISLAND_CORNER, 3);
    const rings: Point[][] = [
      [
        [0, 0],
        [40, 0],
        [40, 40],
        [0, 40],
      ],
      [
        [10, 10],
        [30, 10],
        [30, 30],
        [10, 30],
      ],
    ];
    for (const [x, y, z] of cuts(moves)) {
      expect(x > 10 + 1e-6 && x < 30 - 1e-6 && y > 10 + 1e-6 && y < 30 - 1e-6).toBe(false);
      expect(-z).toBeLessThanOrEqual(edgeDistance([x, y], rings) + 1e-3);
    }
  });

  it("treats a clockwise island the same", () => {
    const clockwise = shape(rectangle(0, 0, 40, 40), rectangle(10, 10, 20, 20, true));
    expect(deepest(carve({}, [clockwise]).moves)).toBeCloseTo(OUTER_TO_ISLAND_CORNER, 3);
  });

  it("goes less deep with a flat tip", () => {
    const tipped = { ...bit, tipDiameter: 2 };
    // Its tip reaches 1 mm further sideways.
    expect(deepest(carve({}, [bar], tipped).moves)).toBeCloseTo(-9, 3);
  });

  it("feeds along slopes up to the plunge angle and plunges on steeper ones", () => {
    const { moves } = carve({}, [bar], { ...bit, plungeAngle: 30 });
    let previous: Vec3 | null = null;
    for (const move of moves) {
      if (move.kind === "feed" && previous) {
        const drop = previous[2] - move.to[2];
        const run = Math.hypot(move.to[0] - previous[0], move.to[1] - previous[1]);
        const steep = drop > 0 && Math.atan2(drop, run) > Math.PI / 6 + 1e-9;
        expect(move.feedRate).toBe(steep ? bit.plungeRate : bit.feedRate);
      }
      previous = move.to;
    }
    // The 45° corner branches are steeper than 30°.
    expect(moves.some((move) => move.kind === "feed" && move.feedRate === bit.plungeRate)).toBe(
      true,
    );
  });

  it("simplifies the dense axis", () => {
    // The centre line is straight and flat: a handful of moves per pass, not one per sample.
    const { moves } = carve({}, [bar], { ...bit, stepDown: 15 });
    expect(moves.length).toBeLessThan(40);
  });

  it("skips points and open paths", () => {
    const open: Path = { start: [0, 0], segments: [{ kind: "line", to: [10, 0] }], closed: false };
    const point: Path = { start: [5, 5], segments: [], closed: false };
    const { moves, warnings } = carve({}, [shape(open, point)]);
    expect(moves).toEqual([]);
    expect(warnings).toEqual([
      "Skipped 1 point: drill them instead.",
      "Skipped 1 open path: V-carving needs closed paths.",
    ]);
  });

  it("refuses other tools", () => {
    expect(() => carve({}, [bar], endMill)).toThrow("Only V-bits V-carve");
  });

  it("is what generateToolpath computes for V-carve operations", () => {
    const operation = vcarve({ maxDepth: 4, flatBottom: { tool: endMill } });
    expect(generateToolpath({ operation, shapes: [bar], safeZ: 5, entryClearance: 1 })).toEqual(
      vcarveToolpath(operation, [bar], options),
    );
  });
});

describe("simplify3d", () => {
  it("drops points on the line through their neighbours, depth included", () => {
    const line: Vec3[] = [
      [0, 0, 0],
      [1, 0, -1],
      [2, 0, -2],
      [3, 0, -2],
      [4, 0, -2],
    ];
    expect(simplify3d(line, 0.01)).toEqual([
      [0, 0, 0],
      [2, 0, -2],
      [4, 0, -2],
    ]);
  });

  it("keeps points further than the tolerance", () => {
    const bump: Vec3[] = [
      [0, 0, 0],
      [1, 0, -0.02],
      [2, 0, 0],
    ];
    expect(simplify3d(bump, 0.01)).toEqual(bump);
    expect(simplify3d(bump, 0.05)).toEqual([
      [0, 0, 0],
      [2, 0, 0],
    ]);
  });
});
