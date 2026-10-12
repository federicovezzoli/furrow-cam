import type { DrillOperation, DrillParams, Path, Point, Shape, Tool } from "@furrow/document";
import { describe, expect, it } from "vitest";
import { drillOrder, drillToolpath } from "./drill";
import { generateToolpath } from "./generate";
import type { Vec3 } from "./stock";
import { importSvg } from "./svg/import";
import type { Toolpath } from "./toolpath";

const tool: Tool = {
  name: "6 mm drill",
  type: "drill",
  diameter: 6,
  fluteCount: 2,
  fluteLength: 30,
  cutDirection: null,
  vAngle: null,
  tipDiameter: null,
  spindleRpm: 12000,
  feedRate: 1000,
  plungeRate: 300,
  plungeAngle: 90,
  stepDown: 4,
  stepOver: 40,
  notes: null,
  color: "#2563eb",
};

const params: DrillParams = { depth: 10, peck: false };

function circle(center: Point, radius: number): Path {
  const start: Point = [center[0] + radius, center[1]];
  return { start, segments: [{ kind: "arc", to: start, center, clockwise: false }], closed: true };
}

/** A regular polygon with `sides` vertices on the circle of `radius` around `center`. */
function polygon(center: Point, radius: number, sides: number, rotation = 0): Path {
  const vertex = (i: number): Point => [
    center[0] + radius * Math.cos(rotation + (2 * Math.PI * i) / sides),
    center[1] + radius * Math.sin(rotation + (2 * Math.PI * i) / sides),
  ];
  return {
    start: vertex(0),
    segments: Array.from({ length: sides - 1 }, (_, i) => ({ kind: "line", to: vertex(i + 1) })),
    closed: true,
  };
}

function point(at: Point): Path {
  return { start: at, segments: [], closed: false };
}

let shapeCount = 0;
function shape(...paths: Path[]): Shape {
  shapeCount++;
  return {
    id: `00000000-0000-4000-8000-${String(shapeCount).padStart(12, "0")}`,
    name: "",
    layer: "0",
    paths,
  };
}

function drill(
  shapes: Shape[],
  overrides: Partial<DrillParams> = {},
  safeZ = 5,
  toolOverrides: Partial<Tool> = {},
): Toolpath {
  const operation: DrillOperation = {
    id: "11111111-2222-4333-8444-555555555555",
    name: "Drill",
    enabled: true,
    type: "drill",
    targets: shapes.map((s) => ({ shapeId: s.id, paths: null })),
    tool: { ...tool, ...toolOverrides },
    params: { ...params, ...overrides },
  };
  return drillToolpath(operation, shapes, { safeZ });
}

/** The `[x, y]` of each feed move, once per hole in order. */
function holeOrder(toolpath: Toolpath): Point[] {
  const holes: Point[] = [];
  for (const move of toolpath.moves) {
    const [x, y] = move.to;
    const last = holes.at(-1);
    if (move.kind === "feed" && (!last || last[0] !== x || last[1] !== y)) holes.push([x, y]);
  }
  return holes;
}

describe("drillToolpath", () => {
  it("plunges once to depth at a point, then retracts", () => {
    const toolpath = drill([shape(point([20, 30]))]);
    expect(toolpath.warnings).toEqual([]);
    expect(toolpath.moves).toEqual([
      { kind: "rapid", to: [20, 30, 5] },
      { kind: "rapid", to: [20, 30, 1] },
      { kind: "feed", to: [20, 30, -10], feedRate: 300 },
      { kind: "rapid", to: [20, 30, 5] },
    ]);
  });

  it("pecks no deeper than the step-down, clearing chips above the stock after each", () => {
    const toolpath = drill([shape(point([0, 0]))], { peck: true });
    // 10 mm in pecks of at most 4 mm: three of 10/3 mm.
    const z = toolpath.moves.map((move) => [move.kind, move.to[2]]);
    const peck = 10 / 3;
    expect(z).toEqual([
      ["rapid", 5],
      ["rapid", 1],
      ["feed", -peck],
      ["rapid", 1],
      ["rapid", -peck + 1],
      ["feed", -2 * peck],
      ["rapid", 1],
      ["rapid", -2 * peck + 1],
      ["feed", -10],
      ["rapid", 5],
    ]);
    expect(toolpath.moves.every((move) => move.to[0] === 0 && move.to[1] === 0)).toBe(true);
  });

  it("plunges once when pecking a hole no deeper than the step-down", () => {
    const toolpath = drill([shape(point([0, 0]))], { peck: true, depth: 4 });
    expect(toolpath.moves.filter((move) => move.kind === "feed")).toHaveLength(1);
  });

  it("drills circles of the tool diameter at their centre, within 0.1 mm", () => {
    const shapes = [
      shape(circle([10, 10], 3)),
      shape(circle([30, 10], 3.05)),
      shape(circle([50, 10], 2.95)),
    ];
    const toolpath = drill(shapes);
    expect(toolpath.warnings).toEqual([]);
    expect(holeOrder(toolpath)).toEqual([
      [10, 10],
      [30, 10],
      [50, 10],
    ]);
  });

  it("skips circles smaller than the tool, larger than a drill bit, and paths that aren't circles or points", () => {
    const square: Path = {
      start: [0, 0],
      segments: [
        { kind: "line", to: [10, 0] },
        { kind: "line", to: [10, 10] },
        { kind: "line", to: [0, 10] },
      ],
      closed: true,
    };
    const open: Path = { start: [0, 0], segments: [{ kind: "line", to: [5, 5] }], closed: false };
    const toolpath = drill([shape(circle([10, 10], 3.2), circle([20, 20], 2), square, open)]);
    expect(toolpath.moves).toEqual([]);
    expect(toolpath.warnings).toEqual([
      "Skipped 1 circle smaller than the tool.",
      "Skipped 1 circle larger than the drill: bore them with an end mill.",
      "Skipped 2 paths: drilling needs circles or points.",
    ]);
  });

  it("recognises a circle split into arcs, but not an arc that isn't closed", () => {
    const halves: Path = {
      start: [13, 10],
      segments: [
        { kind: "arc", to: [7, 10], center: [10, 10], clockwise: false },
        { kind: "arc", to: [13, 10], center: [10, 10], clockwise: false },
      ],
      closed: true,
    };
    const half: Path = {
      start: [13, 30],
      segments: [{ kind: "arc", to: [7, 30], center: [10, 30], clockwise: false }],
      closed: true,
    };
    const toolpath = drill([shape(halves, half)]);
    expect(holeOrder(toolpath)).toEqual([[10, 10]]);
    expect(toolpath.warnings).toEqual(["Skipped 1 path: drilling needs circles or points."]);
  });

  it("drills circles exported as polygons or Béziers when the drill reproduces them", () => {
    // OpenSCAD writes circles as 36-gons with their vertices on the circle:
    // the edges come 0.011 mm inside it.
    const k = (4 / 3) * Math.tan(Math.PI / 8) * 3;
    const bezier: Path = {
      start: [53, 10],
      segments: [
        { kind: "cubic", c1: [53, 10 + k], c2: [50 + k, 13], to: [50, 13] },
        { kind: "cubic", c1: [50 - k, 13], c2: [47, 10 + k], to: [47, 10] },
        { kind: "cubic", c1: [47, 10 - k], c2: [50 - k, 7], to: [50, 7] },
        { kind: "cubic", c1: [50 + k, 7], c2: [53, 10 - k], to: [53, 10] },
      ],
      closed: true,
    };
    const toolpath = drill([
      shape(polygon([10, 10], 3, 36), polygon([30, 10], 3, 72, 0.1), bezier),
    ]);
    expect(toolpath.warnings).toEqual([]);
    const holes = holeOrder(toolpath);
    expect(holes).toHaveLength(3);
    [10, 30, 50].forEach((x, i) => {
      expect(holes[i]?.[0]).toBeCloseTo(x, 6);
      expect(holes[i]?.[1]).toBeCloseTo(10, 6);
    });
  });

  it("skips polygons no circle fits within the tolerance, whatever their size", () => {
    // Their corners are on a 6 mm circle, but their sides come far inside it.
    const square = polygon([10, 10], 3, 4);
    const hexagon = polygon([30, 10], 3, 6);
    const coarse = polygon([50, 10], 3, 12);
    const toolpath = drill([shape(square, hexagon, coarse)]);
    expect(toolpath.moves).toEqual([]);
    expect(toolpath.warnings).toEqual(["Skipped 3 paths: drilling needs circles or points."]);
  });

  it("tells round outlines too large for a drill bit from other paths", () => {
    const toolpath = drill([shape(polygon([10, 10], 4, 36), polygon([30, 10], 3, 6))]);
    expect(toolpath.warnings).toEqual([
      "Skipped 1 circle larger than the drill: bore them with an end mill.",
      "Skipped 1 path: drilling needs circles or points.",
    ]);
  });

  it("drills the holes of an OpenSCAD export, skipping the outline", () => {
    // A hole from an OpenSCAD SVG, Ø5.3 mm as a 36-gon, inside an outline in the same path.
    const hole =
      "M 8.53983,-59.1403 L 8.09365,-59.2598 L 7.675,-59.455 L 7.29661,-59.72 L 6.96998,-60.0466 L 6.70503,-60.425 L 6.50981,-60.8436 L 6.39026,-61.2898 L 6.35,-61.75 L 6.39026,-62.2102 L 6.50981,-62.6564 L 6.70503,-63.075 L 6.96998,-63.4534 L 7.29661,-63.78 L 7.675,-64.045 L 8.09365,-64.2402 L 8.53983,-64.3597 L 9,-64.4 L 9.46017,-64.3597 L 9.90635,-64.2402 L 10.325,-64.045 L 10.7034,-63.78 L 11.03,-63.4534 L 11.295,-63.075 L 11.4902,-62.6564 L 11.6097,-62.2102 L 11.65,-61.75 L 11.6097,-61.2898 L 11.4902,-60.8436 L 11.295,-60.425 L 11.03,-60.0466 L 10.7034,-59.72 L 10.325,-59.455 L 9.90635,-59.2598 L 9.46017,-59.1403 L 9,-59.1 z";
    const file = `<svg xmlns="http://www.w3.org/2000/svg" width="20mm" height="80mm" viewBox="0 -79 20 80"><path d="M 0.25,-78 L 18,-78 L 18,0 L 0.25,0 z ${hole}"/></svg>`;
    const { shapes } = importSvg(file, { createId: () => "00000000-0000-4000-8000-000000000999" });
    expect(shapes).toHaveLength(1);
    const toolpath = drill(shapes, {}, 5, { diameter: 5.3 });
    expect(toolpath.warnings).toEqual(["Skipped 1 path: drilling needs circles or points."]);
    const holes = holeOrder(toolpath);
    expect(holes).toHaveLength(1);
    // y flips from SVG's downward axis; the page's bottom is at y = 1 in SVG units.
    expect(holes[0]?.[0]).toBeCloseTo(9, 3);
    expect(holes[0]?.[1]).toBeCloseTo(1 + 61.75, 3);
  });

  it("drills holes at the same centre once", () => {
    const toolpath = drill([shape(circle([10, 10], 3)), shape(point([10, 10.0001]))]);
    expect(holeOrder(toolpath)).toHaveLength(1);
  });

  it("warns when the depth exceeds the flute length", () => {
    const toolpath = drill([shape(point([0, 0]))], { depth: 40 });
    expect(toolpath.warnings).toEqual(["The depth exceeds the tool's flute length."]);
  });

  it("feeds from the retract height when it is below the entry clearance", () => {
    const toolpath = drill([shape(point([0, 0]))], {}, 0.5);
    expect(toolpath.moves.map((move) => move.to[2])).toEqual([0.5, -10, 0.5]);
  });

  it("is what generateToolpath computes for a drill operation", () => {
    const shapes = [shape(point([5, 5]))];
    const operation: DrillOperation = {
      id: "11111111-2222-4333-8444-555555555555",
      name: "Drill",
      enabled: true,
      type: "drill",
      targets: shapes.map((s) => ({ shapeId: s.id, paths: null })),
      tool,
      params,
    };
    expect(generateToolpath({ operation, shapes, safeZ: 5 })).toEqual(
      drillToolpath(operation, shapes, { safeZ: 5 }),
    );
  });
});

function routeLength(route: Point[]): number {
  let length = 0;
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1] as Point;
    const b = route[i] as Point;
    length += Math.hypot(a[0] - b[0], a[1] - b[1]);
  }
  return length;
}

describe("drillOrder", () => {
  const holes = (points: Point[]) => points.map((center) => ({ center }));
  const centers = (route: { center: Point }[]) => route.map((hole) => hole.center);

  it("starts at the hole nearest the stock's bottom-left corner", () => {
    expect(
      drillOrder(
        holes([
          [50, 50],
          [5, 5],
          [100, 0],
        ]),
      )[0]?.center,
    ).toEqual([5, 5]);
  });

  it("drills a row in order whatever order it was given in", () => {
    const row: Point[] = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => [10 + i * 10, 10]);
    const shuffled = [row[5], row[2], row[7], row[0], row[3], row[6], row[1], row[4]] as Point[];
    expect(centers(drillOrder(holes(shuffled)))).toEqual(row);
  });

  it("shortens nearest neighbour until no two moves cross", () => {
    let seed = 1;
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    const points: Point[] = Array.from({ length: 200 }, () => [random() * 500, random() * 300]);
    const route = centers(drillOrder(holes(points)));
    expect(route).toHaveLength(200);
    expect(routeLength(route)).toBeLessThan(routeLength(nearestNeighbour(points)));
    for (let i = 0; i < route.length - 1; i++) {
      for (let j = i + 2; j < route.length - 1; j++) expect(crosses(route, i, j)).toBe(false);
    }
  });

  it("stays quick on thousands of holes, keeping every one", () => {
    const points: Point[] = [];
    for (let i = 0; i < 60; i++) for (let j = 0; j < 50; j++) points.push([i * 10, j * 10]);
    const route = drillOrder(holes(points.reverse()));
    expect(new Set(centers(route).map((p) => p.join())).size).toBe(3000);
  });
});

describe("helical boring", () => {
  const endMill: Partial<Tool> = {
    type: "flat_end_mill",
    cutDirection: "upcut",
    diameter: 2,
    plungeAngle: 3,
    stepDown: 1,
    feedRate: 800,
    plungeRate: 200,
  };

  /** Steps of the toolpath as `[from, to, feedRate]`, feed moves only. */
  function feeds(toolpath: Toolpath): [Vec3, Vec3, number][] {
    const result: [Vec3, Vec3, number][] = [];
    toolpath.moves.forEach((move, i) => {
      const from = toolpath.moves[i - 1]?.to;
      if (from && move.kind === "feed") result.push([from, move.to, move.feedRate]);
    });
    return result;
  }

  it("bores a circle larger than an end mill with a climb helix, then a turn at depth", () => {
    // Ø5.6 hole, Ø2 tool: the centre circles at 0.8, close enough to clear the middle.
    const toolpath = drill([shape(circle([20, 30], 1.8))], { depth: 4 }, 5, endMill);
    expect(toolpath.warnings).toEqual([]);
    const steps = feeds(toolpath);
    const helix = steps.filter(([from, to]) => to[2] < from[2] - 1e-9);
    const bottom = steps.filter(([from, to]) => from[2] === -4 && to[2] === -4);
    expect(helix.length).toBeGreaterThan(0);
    expect(helix.length + bottom.length).toBe(steps.length);

    const slope = Math.tan((3 * Math.PI) / 180);
    for (const [from, to, feedRate] of helix) {
      expect(Math.hypot(to[0] - 20, to[1] - 30)).toBeCloseTo(0.8, 9);
      // Never steeper than the plunge angle, measured along the chords.
      const run = Math.hypot(to[0] - from[0], to[1] - from[1]);
      expect((from[2] - to[2]) / run).toBeLessThanOrEqual(slope + 1e-9);
      // Counter-clockwise around the centre: the wall on the tool's right.
      expect((from[0] - 20) * (to[1] - 30) - (from[1] - 30) * (to[0] - 20)).toBeGreaterThan(0);
      expect(feedRate).toBe(200);
    }
    expect(helix[0]?.[0]).toEqual([20.8, 30, 1]);
    expect(helix.at(-1)?.[1]).toEqual([20.8, 30, -4]);

    // A full turn at depth at the feed rate, then to the centre and out.
    expect(bottom.at(-2)?.[1]).toEqual([20.8, 30, -4]);
    expect(bottom.at(-1)?.[1]).toEqual([20, 30, -4]);
    expect(bottom.every(([, , feedRate]) => feedRate === 800)).toBe(true);
    expect(toolpath.moves.at(-1)).toEqual({ kind: "rapid", to: [20, 30, 5] });
  });

  it("drops no more than the step-down per turn when the plunge angle allows more", () => {
    const toolpath = drill([shape(circle([0, 0], 1.9))], { depth: 3 }, 5, {
      ...endMill,
      plungeAngle: 90,
    });
    const helix = feeds(toolpath).filter(([from, to]) => to[2] < from[2] - 1e-9);
    const drop = helix.reduce((sum, [from, to]) => sum + from[2] - to[2], 0);
    // 4 mm from 1 mm above the stock, at most 1 mm per turn: 4 turns.
    expect(drop).toBeCloseTo(4, 9);
    const perChord = (helix[0]?.[0][2] ?? 0) - (helix[0]?.[1][2] ?? 0);
    expect(perChord * (helix.length / 4)).toBeCloseTo(1, 9);
  });

  it("bores a hole over twice the tool diameter in rings from the inside out, leaving no core", () => {
    // Ø20 hole, Ø2 tool at 40% step-over: rings from 1 to 9, at most 0.8 apart.
    const toolpath = drill([shape(circle([0, 0], 10))], { depth: 2 }, 5, endMill);
    expect(toolpath.warnings).toEqual([]);
    const rings: number[] = [];
    for (const [from, to] of feeds(toolpath)) {
      const r = Math.hypot(to[0], to[1]);
      if (to[2] < from[2] - 1e-9 && !rings.some((ring) => Math.abs(ring - r) < 1e-6)) rings.push(r);
    }
    expect(rings[0]).toBeCloseTo(1, 9);
    expect(rings.at(-1)).toBeCloseTo(9, 9);
    rings.slice(1).forEach((ring, i) => {
      expect(ring).toBeGreaterThan(rings[i] as number);
      expect(ring - (rings[i] as number)).toBeLessThanOrEqual(0.8 + 1e-9);
    });
    // Between rings the tool only rises to just above the stock.
    expect(toolpath.moves.filter((move) => move.to[2] === 5)).toHaveLength(2);
  });

  it("plunges a step-down at a time into a bore too short to ramp along", () => {
    // Ø6.2 hole, Ø6 tool: the centre circles at 0.1, under a millimetre a turn.
    const toolpath = drill([shape(circle([0, 0], 3.1))], { depth: 18 }, 5, {
      ...endMill,
      diameter: 6,
      stepDown: 2,
      fluteLength: 25,
    });
    const steps = feeds(toolpath);
    const plunges = steps.filter(([from, to]) => to[2] < from[2] - 1e-9);
    expect(plunges).toHaveLength(9);
    expect(plunges.every(([from, to]) => from[0] === to[0] && from[1] === to[1])).toBe(true);
    expect(steps.length).toBeLessThan(100);
  });

  it("plunges the end mill into a hole it fits, and bores the larger hole at a shared centre", () => {
    const fits = drill([shape(circle([0, 0], 1))], {}, 5, endMill);
    expect(feeds(fits)).toHaveLength(1);
    const shared = drill([shape(point([0, 0]), circle([0, 0], 1.8))], { depth: 2 }, 5, endMill);
    expect(feeds(shared).every(([, to]) => to[2] >= -2)).toBe(true);
    expect(feeds(shared).some(([, to]) => Math.hypot(to[0], to[1]) > 0.79)).toBe(true);
  });

  it("bores the holes of the OpenSCAD export with a smaller end mill", () => {
    const toolpath = drill([shape(polygon([9, 62.75], 2.65, 36))], {}, 5, endMill);
    expect(toolpath.warnings).toEqual([]);
    expect(feeds(toolpath).length).toBeGreaterThan(36);
  });
});

function nearestNeighbour(holes: Point[]): Point[] {
  const left = [...holes];
  const route: Point[] = [];
  let at: Point = [0, 0];
  while (left.length > 0) {
    left.sort(
      (a, b) => Math.hypot(a[0] - at[0], a[1] - at[1]) - Math.hypot(b[0] - at[0], b[1] - at[1]),
    );
    at = left.shift() as Point;
    route.push(at);
  }
  return route;
}

/** Whether the moves out of `route[i]` and out of `route[j]` cross. */
function crosses(route: Point[], i: number, j: number): boolean {
  const [a, b, c, d] = [route[i], route[i + 1], route[j], route[j + 1]] as [
    Point,
    Point,
    Point,
    Point,
  ];
  const side = (p: Point, q: Point, r: Point) =>
    Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0;
}
