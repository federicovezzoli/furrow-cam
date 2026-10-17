import type {
  FinishingStrategy,
  Model,
  Operation,
  PocketStrategy,
  ProjectDocument,
  ReliefFinishOperation,
  ReliefRoughOperation,
  Tool,
  TouchOff,
} from "@furrow/document";
import {
  ballEndMill,
  endMill,
  fullDocument,
  model as modelFixture,
  reliefFinish,
  reliefRough,
} from "@furrow/document/fixtures";
import { describe, expect, it } from "vitest";
import { simulateCuts } from "../../simulation/simulation";
import { generateToolpath, TOUCH_OFF_WARNING, toolpathCuts, toolpathInputs } from "../generate";
import type { Toolpath } from "../toolpath";
import { createCache } from "./finish";

/** A horizontal rectangle at height `z`, as two triangles. */
function rect(x0: number, y0: number, x1: number, y1: number, z: number): number[] {
  return [x0, y0, z, x1, y0, z, x1, y1, z, x0, y0, z, x1, y1, z, x0, y1, z];
}

/** A vertical wall along Y at `x`, from `z0` up to `z1`. */
function wall(x: number, y0: number, y1: number, z0: number, z1: number): number[] {
  return [x, y0, z0, x, y1, z0, x, y1, z1, x, y0, z0, x, y1, z1, x, y0, z1];
}

/** A 20 × 10 × 10 step (a plateau at -4 over x < 10, the floor at -10), placed at (15, 15). */
const STEP: Model = {
  ...modelFixture,
  bounds: { min: [0, 0, -10], max: [20, 10, 0] },
  placement: { rotation: [0, 0, 0], scale: 1, depth: 10, position: [15, 15] },
};
const stepMesh = new Float32Array([
  ...rect(0, 0, 20, 10, -10),
  ...rect(0, 0, 10, 10, -4),
  ...wall(10, 0, 10, -10, -4),
  ...rect(19.99, 9.99, 20, 10, 0),
]);

/** In the stock's corner, clear of the model. */
const CORNER: TouchOff = { x: 7.5, y: 7.5, diameter: 15 };
/** On the model's floor, past the wall. */
const ON_MODEL: TouchOff = { x: 31, y: 20, diameter: 5 };

let next = 0;
function id() {
  next++;
  return `00000000-0000-4000-8000-${next.toString().padStart(12, "0")}`;
}

function roughing(
  strategy: PocketStrategy,
  params: Partial<ReliefRoughOperation["params"]> = {},
  tool: Tool = endMill,
): ReliefRoughOperation {
  return {
    ...reliefRough,
    id: id(),
    tool,
    params: { ...reliefRough.params, modelId: STEP.id, strategy, stockToLeave: 0, ...params },
  };
}

function finishing(
  strategy: FinishingStrategy,
  params: Partial<ReliefFinishOperation["params"]> = {},
  tool: Tool = ballEndMill,
): ReliefFinishOperation {
  return {
    ...reliefFinish,
    id: id(),
    tool,
    params: { ...reliefFinish.params, modelId: STEP.id, strategy, stepOver: 25, ...params },
  };
}

function project(operations: Operation[], touchOff: TouchOff | null): ProjectDocument {
  const doc = fullDocument();
  return {
    ...doc,
    stock: {
      width: 60,
      height: 50,
      thickness: 18,
      xyOrigin: { anchor: "bottom_left" },
      zOrigin: "stock_top",
      touchOff,
    },
    models: [STEP],
    operations,
  };
}

/** Every operation's toolpath, in order. */
function toolpaths(doc: ProjectDocument): Toolpath[] {
  const context = { mesh: () => stepMesh, cuts: createCache<never>(8) };
  return toolpathInputs(doc).map((input) => generateToolpath(input, context));
}

/** The stock after all of `doc`'s toolpaths, on 0.1 mm cells. */
function simulate(doc: ProjectDocument) {
  const cuts = toolpaths(doc).flatMap((toolpath, i) =>
    toolpathCuts(doc.operations[i] as Operation, toolpath),
  );
  const grid = { columns: 600, rows: 500, cellWidth: 0.1, cellHeight: 0.1 };
  const stock = simulateCuts({ width: 60, height: 50, thickness: 18 }, cuts, grid);
  return (x: number, y: number) =>
    stock.heights[Math.floor(y / 0.1) * grid.columns + Math.floor(x / 0.1)] as number;
}

/**
 * Fails if any cell centred on the pad and on the stock was cut, more than
 * `float32` rounding. Tools may graze the pad's side, so cells within
 * 0.01 mm of its edge don't count.
 */
function expectPadUncut(at: (x: number, y: number) => number, { x, y, diameter }: TouchOff) {
  const r = diameter / 2 - 0.01;
  let lowest = 0;
  for (let column = 0; column < 600; column++) {
    for (let row = 0; row < 500; row++) {
      const [px, py] = [(column + 0.5) * 0.1, (row + 0.5) * 0.1];
      if (Math.hypot(px - x, py - y) <= r) lowest = Math.min(lowest, at(px, py));
    }
  }
  expect(lowest).toBeGreaterThanOrEqual(-1e-3);
}

describe("the touch-off pad", () => {
  const strategies: PocketStrategy[] = [
    { type: "offset" },
    { type: "peel", start: "centre" },
    { type: "linear", angle: 0 },
  ];

  for (const strategy of strategies) {
    it(`stays at the stock top when roughing the whole stock, with ${strategy.type} clearing`, () => {
      const operations = [roughing(strategy, { boundary: { type: "stock" } })];
      const at = simulate(project(operations, CORNER));
      expectPadUncut(at, CORNER);
      // Everything else around it goes down to the floor.
      expect(at(25, 45)).toBeCloseTo(-10);
      // Without the pad, its corner is cleared.
      expect(simulate(project(operations, null))(7.55, 7.55)).toBeCloseTo(-10);
    });

    it(`stays at the stock top on the model, with ${strategy.type} clearing`, () => {
      const at = simulate(project([roughing(strategy)], ON_MODEL));
      expectPadUncut(at, ON_MODEL);
    });
  }

  const finishes: FinishingStrategy[] = [
    { type: "parallel", angle: 0, direction: "zigzag" },
    { type: "parallel", angle: 30, direction: "one_way" },
    { type: "waterline", stepDown: 1 },
    { type: "spiral", start: "outside" },
  ];
  for (const strategy of finishes) {
    it(`stays at the stock top after roughing and ${strategy.type} finishing`, () => {
      for (const tool of [ballEndMill, endMill]) {
        const operations = [
          roughing({ type: "offset" }, { boundary: { type: "stock" } }),
          finishing(strategy, {}, tool),
        ];
        expectPadUncut(simulate(project(operations, ON_MODEL)), ON_MODEL);
      }
    });
  }

  it("stays at the stock top with rest machining", () => {
    const bigMill = { ...endMill, diameter: 10, stepDown: 3 };
    const operations = [
      roughing({ type: "offset" }, { boundary: { type: "stock" } }, bigMill),
      roughing({ type: "offset" }, { boundary: { type: "stock" }, rest: true }),
      finishing({ type: "parallel", angle: 0, direction: "zigzag" }, { rest: true }),
    ];
    const at = simulate(project(operations, ON_MODEL));
    expectPadUncut(at, ON_MODEL);
    expectPadUncut(simulate(project(operations, CORNER)), CORNER);
  });

  it("is left alone by linear roughing's links along the stock's edge, past the model", () => {
    // Passes along X a whole tool apart, linked along the stock's left edge.
    // A small pad 3 mm in from it, somewhere between two passes, is out of
    // the passes' reach near the edge but in a straight link's.
    for (let y = 20; y < 20 + endMill.diameter; y += 0.5) {
      const pad = { x: 3, y, diameter: 1 };
      const operations = [
        roughing({ type: "linear", angle: 0 }, { boundary: { type: "stock" }, stepOver: 100 }),
      ];
      expectPadUncut(simulate(project(operations, pad)), pad);
    }
  });

  it("is ignored with the Z zero on the machine bed", () => {
    const operations = [roughing({ type: "offset" }, { boundary: { type: "stock" } })];
    const doc = project(operations, CORNER);
    const onBed = { ...doc, stock: { ...doc.stock, zOrigin: "machine_bed" as const } };
    expect(toolpathInputs(onBed)[0]?.touchOff).toBeNull();
    expect(toolpaths(onBed)).toEqual(toolpaths(project(operations, null)));
  });

  it("recomputes the toolpaths when it changes, its centre staying put", () => {
    const operations = [roughing({ type: "offset" }, { boundary: { type: "stock" } })];
    const wider = { ...CORNER, diameter: 20 };
    const at = simulate(project(operations, wider));
    expectPadUncut(at, wider);
    // Wider about the same centre: it now reaches past the stock's edges.
    expect(at(17, 7.5)).toBe(0);
  });
});

describe("2D operations and the touch-off pad", () => {
  it("warn when they cut into it, and leave it to the user", () => {
    const doc = fullDocument();
    const stock = { ...doc.stock, zOrigin: "stock_top" as const };
    const profile = doc.operations[0] as Operation;
    const clear = toolpathInputs({
      ...doc,
      stock: { ...stock, touchOff: { x: -500, y: -500, diameter: 15 } },
    });
    expect(generateToolpath(clear[0] as never).warnings).not.toContain(TOUCH_OFF_WARNING);
    // A pad over the profile's start.
    const first = generateToolpath(clear[0] as never).moves.find(({ to }) => to[2] < 0)?.to;
    if (!first) throw new Error("no cut");
    const over = { x: first[0], y: first[1], diameter: 15 };
    const [input] = toolpathInputs({ ...doc, stock: { ...stock, touchOff: over } }, [profile]);
    const toolpath = generateToolpath(input as never);
    expect(toolpath.warnings).toContain(TOUCH_OFF_WARNING);
    // Warned, not clipped: the cut is the same.
    expect(toolpath.moves).toEqual(generateToolpath(clear[0] as never).moves);
  });
});
