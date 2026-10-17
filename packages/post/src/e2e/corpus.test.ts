import type { Vec3 } from "@furrow/cam-core";
import { describe, expect, it } from "vitest";
import { exportGcode } from "../export";
import {
  checkGcode,
  formatViolations,
  type GcodeMove,
  operationMoves,
  simulateGcode,
} from "./check";
import { type CorpusProject, corpus } from "./projects";

const projects = corpus();

describe.each(projects)(
  "$name: $covers",
  ({ name, title, document, context, warnings: expected = [] }) => {
    const { gcode, warnings } = exportGcode(document, title, context);

    it("posts the program checked in", async () => {
      await expect(gcode).toMatchFileSnapshot(`programs/${name}.gcode`);
    });

    it("is safe to run on its machine", () => {
      expect(formatViolations(checkGcode(gcode, document))).toBe("");
    });

    it("warns about what it should, and nothing else", () => {
      expect(warnings).toEqual(expected);
    });
  },
);

/** The program of the corpus project `name`, split by operation. */
function program(name: string) {
  const project = projects.find((candidate) => candidate.name === name) as CorpusProject;
  const { gcode } = exportGcode(project.document, project.title, project.context);
  const operations = operationMoves(gcode);
  /** The cutting moves of operation `operation`. */
  const feeds = (operation: string) => {
    const moves = operations.get(operation);
    if (!moves) throw new Error(`${name} has no operation "${operation}"`);
    return moves.filter((move) => move.kind === "feed");
  };
  /**
   * The points every `step` mm from `from` to `to` (work coordinates) where
   * the program leaves the stock higher than `z`, as `[x, y, height]`.
   */
  const above = (from: [number, number], to: [number, number], z: number, step = 1) => {
    const stock = simulateGcode(gcode, project.document);
    const steps = Math.ceil(Math.hypot(to[0] - from[0], to[1] - from[1]) / step);
    const left: [number, number, number][] = [];
    for (let i = 0; i <= steps; i++) {
      const x = from[0] + ((to[0] - from[0]) * i) / steps;
      const y = from[1] + ((to[1] - from[1]) * i) / steps;
      const height = stock.height(x, y);
      if (height !== null && height > z + 0.01) left.push([round(x), round(y), round(height)]);
    }
    return left;
  };
  return { project, gcode, feeds, above };
}

const round = (value: number) => Math.round(value * 1000) / 1000;

function deepest(moves: GcodeMove[]): number {
  return Math.min(...moves.map(({ to }) => to[2]));
}

/** The moves that end within `distance` of `[x, y]`, in work coordinates. */
function near(moves: GcodeMove[], [x, y]: [number, number], distance: number): GcodeMove[] {
  return moves.filter(({ to }) => Math.hypot(to[0] - x, to[1] - y) <= distance + 1e-3);
}

const xy = ({ to }: GcodeMove): [number, number] => [to[0], to[1]];

/**
 * The moves along an edge at `y` that cross a tab centred on `x` flat: both
 * ends within `halfWidth` of it, the tool's radius included, at one height.
 * The climbs onto the tab and back down are at its edges.
 */
function overTab(moves: GcodeMove[], x: number, y: number, halfWidth: number): GcodeMove[] {
  const inside = (point: Vec3) =>
    Math.abs(point[1] - y) < 1e-3 && Math.abs(point[0] - x) <= halfWidth + 1e-3;
  return moves.filter(({ from, to }) => inside(from) && inside(to) && from[2] === to[2]);
}

// What the stored programs can't tell at a glance: that the part comes out
// the size and depth it was drawn, wherever the work is zeroed.
describe("measured", () => {
  it("drills the plate's holes at their centres, through the stock", () => {
    const { gcode, feeds } = program("plate-shapeoko");
    const bottoms = feeds("Holes").filter(({ to }) => to[2] === -6);
    expect(bottoms.map(xy)).toEqual([
      [40, 40],
      [80, 80],
      [120, 40],
    ]);
    expect(deepest(feeds("Recess"))).toBe(-3);
    expect(gcode).not.toContain("Disabled");
  });

  it("leaves the plate's tab standing and cuts through everywhere else", () => {
    const { feeds } = program("plate-shapeoko");
    const profile = feeds("Cut out");
    expect(deepest(profile)).toBe(-6);
    // The bottom edge, offset by the tool's radius; the tab is 6 mm wide at X80.
    const y = 20 - 3.175;
    const tab = overTab(profile, 80, y, 3 + 3.175);
    expect(tab.length).toBeGreaterThan(0);
    expect(deepest(tab)).toBe(-4);
    const edge = profile.filter(({ to }) => Math.abs(to[1] - y) < 1e-3 && to[0] < 60);
    expect(deepest(edge)).toBe(-6);
  });

  it("cuts the plate free all along its bottom edge but at the tab", () => {
    const { above } = program("plate-shapeoko");
    // Under the tool's centre, the tab and a cell either side left out.
    const y = 20 - 3.175;
    expect(above([20, y], [80 - 3 - 3.175 - 1, y], -6)).toEqual([]);
    expect(above([80 + 3 + 3.175 + 1, y], [140, y], -6)).toEqual([]);
  });

  it("cuts the SVG part through to the bed, its tabs 3 mm high", () => {
    const { feeds } = program("svg-part");
    // Zeroed at the centre of the machine bed: the stock top is Z12.
    for (const centre of [
      [-40, -20],
      [40, -20],
      [-40, 20],
      [40, 20],
    ] as [number, number][]) {
      const hole = near(feeds("Holes"), centre, 4 - 3.175);
      expect(deepest(hole)).toBe(0);
    }
    expect(deepest(feeds("Slot"))).toBe(8);
    const profile = feeds("Cut out");
    expect(deepest(profile)).toBe(0);
    // The finish pass, on the exact outline: its straight edges 50 mm from the centre.
    expect(profile.some(({ to }) => Math.abs(to[0] - (50 + 3.175)) < 1e-3 && to[2] === 0)).toBe(
      true,
    );
    // The 8 mm tabs at the middle of the long edges, on the roughing passes
    // 0.5 mm out and on the finish pass.
    for (const offset of [3.175 + 0.5, 3.175]) {
      for (const y of [-(30 + offset), 30 + offset]) {
        const tab = overTab(profile, 0, y, 4 + 3.175);
        expect(tab.length).toBeGreaterThan(0);
        expect(deepest(tab)).toBe(3);
      }
    }
  });

  // A known bug: with ramping on, a profile goes back down after a tab along
  // the whole next segment of the contour instead of at the plunge angle,
  // leaving a wedge of stock behind each tab (#153). Drop `.fails` once it is fixed.
  it.fails("cuts the SVG part free all along its long edges but at the tabs", () => {
    const { above } = program("svg-part");
    for (const y of [-(30 + 3.175), 30 + 3.175]) {
      expect(above([-45, y], [-(4 + 3.175 + 1), y], 0)).toEqual([]);
      expect(above([4 + 3.175 + 1, y], [45, y], 0)).toEqual([]);
    }
  });

  it("bores the sign's hole in a helix around its centre", () => {
    const { feeds } = program("svg-sign");
    const helix = feeds("Hanging hole");
    expect(deepest(helix)).toBe(-10);
    // Down at the hole's radius less the tool's, then to the centre to clear the core.
    const [last, ...down] = helix.filter(({ to }) => to[2] < 0).reverse();
    for (const { to } of down) {
      expect(Math.hypot(to[0] - 40, to[1] - 40)).toBeCloseTo(4 - 3.175, 2);
    }
    expect(last && xy(last)).toEqual([40, 40]);
    expect(deepest(feeds("Border"))).toBe(-1.5);
    expect(deepest(feeds("Square"))).toBe(-3);
  });

  it("cuts the inch panel to its inch depths, around its knob", () => {
    const { feeds } = program("inch-panel");
    expect(deepest(feeds("Label"))).toBe(-1.016);
    expect(deepest(feeds("Frame"))).toBe(-12.7);
    const window = feeds("Window");
    expect(deepest(window)).toBe(-6.35);
    // The knob, 0.2 in round, 1.25 in right of and 1.1 in up from the frame's
    // corner at the stock's; the zero is 1 in in from both edges.
    const knob: [number, number] = [6.35, 2.54];
    const inKnob = near(
      window.filter(({ to }) => to[2] < 0),
      knob,
      5.08 + 3.175 - 0.01,
    );
    expect(inKnob).toEqual([]);
    expect(near(window, knob, 5.08 + 3.175 + 0.5).length).toBeGreaterThan(0);
  });

  it("finishes the relief no deeper than the model, inside the stock", () => {
    const { feeds, project } = program("relief");
    const extent = (moves: GcodeMove[], axis: number) =>
      moves.map(({ to }) => (to as Vec3)[axis] as number);
    // The model's top is at the stock top, its base as deep as it is placed.
    const depth = project.document.models[0]?.placement.depth as number;
    expect(depth).toBe(4);
    for (const operation of ["Rough", "Finish", "Rest finish"]) {
      const moves = feeds(operation);
      expect(Math.min(...extent(moves, 0))).toBeGreaterThanOrEqual(0);
      expect(Math.max(...extent(moves, 0))).toBeLessThanOrEqual(40);
      expect(Math.min(...extent(moves, 1))).toBeGreaterThanOrEqual(0);
      expect(Math.max(...extent(moves, 1))).toBeLessThanOrEqual(30);
      expect(deepest(moves)).toBeGreaterThanOrEqual(-depth);
    }
    // Roughing leaves its 0.5 mm on the model, down to its base.
    expect(deepest(feeds("Rough"))).toBe(-depth + 0.5);
  });
});

describe("measured: the touch-off pad (ADR-0041)", () => {
  it("is left at the stock top and visited before every tool change", () => {
    const { project, gcode, above } = program("relief-touch-off");
    const pad = project.document.stock.touchOff;
    if (!pad) throw new Error("no pad");
    // Zeroed at the bottom-left corner of the stock top: work coordinates are stock ones.
    const r = pad.diameter / 2 - 0.1;
    for (const [from, to] of [
      [
        [pad.x - r, pad.y],
        [pad.x + r, pad.y],
      ],
      [
        [pad.x, pad.y - r],
        [pad.x, pad.y + r],
      ],
    ] as [[number, number], [number, number]][]) {
      // Every point across it is above the cut, as every point is above the stock bottom.
      expect(above(from, to, -0.05, 0.1)).toEqual(above(from, to, -1000, 0.1));
    }
    const lines = gcode.split("\n");
    const pauses = lines.flatMap((line, i) => (line.startsWith("M0") ? [i] : []));
    expect(pauses.length).toBeGreaterThan(0);
    for (const i of pauses) {
      expect(lines[i - 1]).toBe(`G0 X${pad.x} Y${pad.y}`);
      expect(lines[i]).toContain("zero Z on the touch-off pad");
    }
  });
});

// The workshop's jobs, measured against the Estlcam programs that cut them:
// the same drawings and bits give tool paths the same size, to the micron.
describe("measured against Estlcam", () => {
  /** The size of the area the operation's cuts cover, X by Y. */
  function span(moves: GcodeMove[]): [number, number] {
    const xs = moves.map(({ to }) => to[0]);
    const ys = moves.map(({ to }) => to[1]);
    return [round(Math.max(...xs) - Math.min(...xs)), round(Math.max(...ys) - Math.min(...ys))];
  }

  it("cuts the strut plate out as Estlcam did, its holes Ø5.3 mm", () => {
    const { feeds } = program("strut-plate");
    // Estlcam turned the plate a quarter turn: 95.1 × 1074.5 mm there.
    expect(span(feeds("Plate"))).toEqual([1074.5, 95.1]);
    expect(deepest(feeds("Plate"))).toBe(-5);
    // 14 holes, each profiled 1.15 mm from its centre, the Ø5.3 mm hole
    // less the 3 mm bit, as Estlcam's helix: a 35-gon just inside that circle.
    const holes = feeds("Holes").filter(({ to }) => to[2] < 0);
    expect(deepest(holes)).toBe(-5);
    const clusters: GcodeMove[][] = [];
    for (const move of holes) {
      const cluster = clusters.find(([first]) => first && near([first], xy(move), 5).length > 0);
      if (cluster) cluster.push(move);
      else clusters.push([move]);
    }
    expect(clusters).toHaveLength(14);
    for (const cluster of clusters) {
      const [width, height] = span(cluster);
      expect(width).toBeCloseTo(2.3, 1);
      expect(height).toBeCloseTo(2.3, 1);
    }
  });

  it("clears the PC shelf's channel and recess, and cuts it out, as Estlcam did", () => {
    const { feeds } = program("pc-shelf");
    expect(span(feeds("Channel"))).toEqual([36.978, 320.571]);
    expect(deepest(feeds("Channel"))).toBe(-30);
    expect(span(feeds("Recess"))).toEqual([175, 305]);
    expect(deepest(feeds("Recess"))).toBe(-5);
    expect(span(feeds("Cut out"))).toEqual([266, 386]);
    // Estlcam cut 1 mm into the spoilboard; Furrow stops at the stock's bottom.
    expect(deepest(feeds("Cut out"))).toBe(-40);
  });

  // The same wedge behind the shelf's 10 mm tabs, 102 to 162 mm long (#153).
  it.fails("cuts the PC shelf free along its sides but at the tabs", () => {
    const { above } = program("pc-shelf");
    for (const x of [-133, 133]) {
      expect(above([x, -170], [x, -(5 + 3 + 1)], -40)).toEqual([]);
      expect(above([x, 5 + 3 + 1], [x, 170], -40)).toEqual([]);
    }
  });

  it("cuts the shelf's handle out as Estlcam did", () => {
    const { feeds } = program("pc-shelf-handle");
    expect(span(feeds("Cut out"))).toEqual([158, 62]);
    expect(deepest(feeds("Cut out"))).toBe(-18);
  });

  it("grooves the doors along the same 56 lines as Estlcam, 87.4 m of cutting", () => {
    const { feeds } = program("fluted-doors");
    const flutes = feeds("Flutes");
    expect(span(flutes)).toEqual([845, 1186.962]);
    expect(deepest(flutes)).toBe(-4);
    const length = flutes.reduce(
      (total, { from, to }) =>
        total + Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]),
      0,
    );
    // Estlcam's program cuts 87.40 m, its ramps at both ends of each line.
    expect(length / 1000).toBeCloseTo(87.4, 1);
  });
});
