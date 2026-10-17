import type {
  Model,
  Operation,
  ProjectDocument,
  ReliefFinishOperation,
  ReliefRoughOperation,
  Tool,
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
import {
  cutterProfile,
  type SimulationCut,
  simulateCuts,
  sweepMoves,
} from "../../simulation/simulation";
import {
  generateToolpath,
  isRestMachining,
  type ToolpathContext,
  toolpathCuts,
  toolpathInputs,
  toolpathKey,
} from "../generate";
import type { Toolpath, ToolpathMove } from "../toolpath";
import { createCache, remainingRuns } from "./finish";

/** A horizontal rectangle at height `z`, as two triangles. */
function rect(x0: number, y0: number, x1: number, y1: number, z: number): number[] {
  return [x0, y0, z, x1, y0, z, x1, y1, z, x0, y0, z, x1, y1, z, x0, y1, z];
}

/** A 30 × 30 × 6 block with a 20 × 20 pocket through its depth, its mesh in stock coordinates. */
const POCKET: Model = {
  ...modelFixture,
  bounds: { min: [0, 0, -6], max: [30, 30, 0] },
  placement: { rotation: [0, 0, 0], scale: 1, depth: 6, position: [0, 0] },
};
const pocketMesh = new Float32Array([
  ...rect(5, 5, 25, 25, -6),
  ...rect(0, 0, 30, 5, 0),
  ...rect(0, 25, 30, 30, 0),
  ...rect(0, 5, 5, 25, 0),
  ...rect(25, 5, 30, 25, 0),
]);
const CORNERS = [
  [5, 5],
  [25, 5],
  [5, 25],
  [25, 25],
] as const;

const bigMill: Tool = { ...endMill, name: "10 mm end mill", diameter: 10, stepDown: 3 };
const smallMill: Tool = { ...endMill, name: "3 mm end mill", diameter: 3, stepDown: 3 };

let next = 0;
function id() {
  next++;
  return `00000000-0000-4000-8000-${next.toString().padStart(12, "0")}`;
}

function roughing(
  tool: Tool,
  params: Partial<ReliefRoughOperation["params"]> = {},
): ReliefRoughOperation {
  return {
    ...reliefRough,
    id: id(),
    tool,
    params: { ...reliefRough.params, modelId: POCKET.id, stockToLeave: 0, ...params },
  };
}

function finishing(
  tool: Tool,
  params: Partial<ReliefFinishOperation["params"]> = {},
): ReliefFinishOperation {
  return {
    ...reliefFinish,
    id: id(),
    tool,
    params: { ...reliefFinish.params, modelId: POCKET.id, stepOver: 25, ...params },
  };
}

function project(operations: Operation[]): ProjectDocument {
  return { ...fullDocument(), models: [POCKET], operations };
}

function context(): ToolpathContext {
  return { mesh: () => pocketMesh, cuts: createCache<SimulationCut[]>(8) };
}

/** The toolpath of the last operation of `operations`. */
function last(operations: Operation[], toolpathContext = context()): Toolpath {
  const inputs = toolpathInputs(project(operations));
  let toolpath: Toolpath = { moves: [], warnings: [] };
  for (const input of inputs) toolpath = generateToolpath(input, toolpathContext);
  return toolpath;
}

/** Feed moves below `z`: those that cut into the pocket. */
const cutsBelow = ({ moves }: Toolpath, z: number) =>
  moves.filter(
    (move): move is Extract<ToolpathMove, { kind: "feed" }> =>
      move.kind === "feed" && move.to[2] < z,
  );

const nearestCorner = ([x, y]: readonly number[]) =>
  Math.min(...CORNERS.map(([cx, cy]) => Math.hypot((x as number) - cx, (y as number) - cy)));

describe("remainingRuns", () => {
  const runs = (flags: string, gap = 0) =>
    remainingRuns((i) => flags[i] === "x", flags.length, gap);

  it("grows each run by a sample on both sides", () => {
    expect(runs("..xx....x.")).toEqual([
      [1, 4],
      [7, 9],
    ]);
  });

  it("stops at the ends", () => {
    expect(runs("x..x")).toEqual([
      [0, 1],
      [2, 3],
    ]);
  });

  it("joins runs across short gaps", () => {
    expect(runs("x.....x", 4)).toEqual([[0, 6]]);
    expect(runs("x.....x", 2)).toEqual([
      [0, 1],
      [5, 6],
    ]);
  });

  it("is empty with nothing left", () => {
    expect(runs("....")).toEqual([]);
  });
});

describe("rest machining", () => {
  it("cuts everything with nothing before it", () => {
    const alone = last([roughing(smallMill, { rest: true })]);
    const full = last([roughing(smallMill)]);
    expect(alone.moves).toEqual(full.moves);
  });

  for (const strategy of [{ type: "offset" }, { type: "linear", angle: 0 }] as const) {
    it(`leaves only the corners for a small tool after a big one, with ${strategy.type} clearing`, () => {
      const big = roughing(bigMill);
      const small = roughing(smallMill, { strategy, rest: true });
      const rest = cutsBelow(last([big, small]), -0.5);
      // Something is left in every corner, and the small tool cuts nothing else.
      expect(rest.length).toBeGreaterThan(0);
      for (const [cx, cy] of CORNERS) {
        expect(rest.some(({ to }) => Math.hypot(to[0] - cx, to[1] - cy) < 5)).toBe(true);
      }
      for (const { to } of rest) expect(nearestCorner(to)).toBeLessThan(5 + 3 + 1);

      const everything = cutsBelow(last([big, roughing(smallMill, { strategy })]), -0.5);
      expect(everything.some(({ to }) => nearestCorner(to) > 10)).toBe(true);
    });
  }

  for (const strategy of [{ type: "offset" }, { type: "linear", angle: 0 }] as const) {
    it(`has nothing to cut after the same roughing, with ${strategy.type} clearing`, () => {
      const toolpath = last([
        roughing(bigMill, { strategy }),
        roughing(bigMill, { strategy, rest: true }),
      ]);
      expect(toolpath.moves.filter(({ kind }) => kind === "feed")).toEqual([]);
    });
  }

  it("keeps to the margin, with nothing to cut after the same roughing", () => {
    // The pocket model at (20, 20) on the 300 × 200 stock: the margin is (15, 15) to (65, 65).
    const inset: Model = { ...POCKET, placement: { ...POCKET.placement, position: [20, 20] } };
    const boundary = { type: "margin", distance: 5 } as const;
    const run = (operations: Operation[]) => {
      const inputs = toolpathInputs({ ...project(operations), models: [inset] });
      let toolpath: Toolpath = { moves: [], warnings: [] };
      for (const input of inputs) toolpath = generateToolpath(input, context());
      return toolpath;
    };
    const small = run([
      roughing(bigMill, { boundary }),
      roughing(smallMill, { boundary, rest: true }),
    ]);
    expect(cutsBelow(small, -0.5).length).toBeGreaterThan(0);
    for (const { to } of small.moves.filter(({ kind }) => kind === "feed")) {
      expect(to[0]).toBeGreaterThanOrEqual(15 + 1.5 - 1e-6);
      expect(to[0]).toBeLessThanOrEqual(65 - 1.5 + 1e-6);
      expect(to[1]).toBeGreaterThanOrEqual(15 + 1.5 - 1e-6);
      expect(to[1]).toBeLessThanOrEqual(65 - 1.5 + 1e-6);
    }
    const again = run([
      roughing(bigMill, { boundary }),
      roughing(bigMill, { boundary, rest: true }),
    ]);
    expect(again.moves.filter(({ kind }) => kind === "feed")).toEqual([]);
  });

  const sequences: [string, () => Operation[]][] = [
    ["offset roughing", () => [roughing(bigMill), roughing(smallMill, { rest: true })]],
    [
      "linear roughing",
      () => [
        roughing(bigMill),
        roughing(smallMill, { strategy: { type: "linear", angle: 0 }, rest: true }),
      ],
    ],
    [
      "finishing",
      () => [roughing(endMill, { stockToLeave: 0.5 }), finishing(ballEndMill, { rest: true })],
    ],
  ];
  for (const [label, operations] of sequences) {
    it(`never rapids into the stock left, with ${label}`, () => {
      const toolpathContext = context();
      const inputs = toolpathInputs(project(operations()));
      const earlier = inputs.slice(0, -1).flatMap((input) => {
        const toolpath = generateToolpath(input, toolpathContext);
        return toolpathCuts(input.operation, toolpath);
      });
      const restInput = inputs.at(-1);
      if (!restInput) throw new Error("no input");
      const { moves, warnings } = generateToolpath(restInput, toolpathContext);
      expect(warnings).toEqual([]);
      // Each move in order, on the stock as it is then: a rapid must never cut.
      const grid = { columns: 400, rows: 400, cellWidth: 0.1, cellHeight: 0.1 };
      const heights = simulateCuts({ width: 40, height: 40, thickness: 18 }, earlier, grid).heights;
      const profile = cutterProfile(restInput.operation.tool);
      let deepest = 0;
      for (let i = 1; i < moves.length; i++) {
        const move = moves[i] as ToolpathMove;
        const segment = new Float32Array([...(moves[i - 1] as ToolpathMove).to, ...move.to]);
        const before = move.kind === "rapid" ? heights.slice() : null;
        sweepMoves(grid, heights, profile, segment, 0, 1);
        if (!before) continue;
        for (let k = 0; k < heights.length; k++) {
          deepest = Math.max(deepest, (before[k] as number) - (heights[k] as number));
        }
      }
      expect(deepest).toBeLessThan(1e-3);
    });
  }

  it("rapids across the pocket between the corners", () => {
    const toolpath = last([
      roughing(bigMill),
      roughing(smallMill, { strategy: { type: "linear", angle: 0 }, rest: true }),
    ]);
    // A pass through two corners crosses the middle at a rapid, not a feed.
    const { moves } = toolpath;
    const across = moves.findIndex(
      (move, i) =>
        i > 0 &&
        move.kind === "rapid" &&
        Math.abs(move.to[0] - (moves[i - 1] as ToolpathMove).to[0]) > 10,
    );
    expect(across).toBeGreaterThan(0);
  });

  it("finishes only where roughing left the stock to leave", () => {
    const rough = roughing(endMill, { stockToLeave: 0.5 });
    const finish = finishing(ballEndMill, { rest: true });
    expect(cutsBelow(last([rough, finish]), 0.5).length).toBeGreaterThan(0);
  });

  it("has nothing to cut after the same finishing", () => {
    const once = finishing(ballEndMill);
    const again = finishing(ballEndMill, { rest: true });
    const toolpath = last([once, again]);
    expect(toolpath.moves.filter(({ kind }) => kind === "feed")).toEqual([]);
  });

  it("ignores disabled operations and those after it", () => {
    const disabled = { ...roughing(bigMill), enabled: false };
    const rest = finishing(ballEndMill, { rest: true });
    const after = roughing(bigMill);
    const input = toolpathInputs(project([disabled, rest, after]))[1];
    expect(input?.before).toEqual([]);
    expect(input?.stock).toEqual({ min: [0, 0], max: [300, 200] });
  });

  it("computes the operations before it, or takes them from the context", () => {
    const big = roughing(bigMill);
    const small = roughing(smallMill, { rest: true });
    const [bigInput, smallInput] = toolpathInputs(project([big, small]));
    if (!bigInput || !smallInput) throw new Error("no inputs");
    const fresh = generateToolpath(smallInput, { mesh: () => pocketMesh });

    const cached = context();
    const bigToolpath = generateToolpath(bigInput, cached);
    expect(cached.cuts?.get(toolpathKey(bigInput))).toEqual(toolpathCuts(big, bigToolpath));
    expect(generateToolpath(smallInput, cached)).toEqual(fresh);

    // A cached toolpath is used as it is: with none, everything is left.
    const empty = context();
    empty.cuts?.set(toolpathKey(bigInput), []);
    expect(generateToolpath(smallInput, empty).moves).toEqual(last([small]).moves);
  });
});

describe("toolpathInputs", () => {
  const big = roughing(bigMill);
  const small = roughing(smallMill, { rest: true });
  const key = (operations: Operation[], index: number) =>
    toolpathKey(toolpathInputs(project(operations))[index] as never);

  it("gives a rest operation the inputs of the enabled operations before it", () => {
    const inputs = toolpathInputs(project([big, small]));
    expect(inputs[1]?.before).toEqual([inputs[0]]);
    expect(inputs[0]?.before).toEqual([]);
    expect(isRestMachining(small)).toBe(true);
    expect(isRestMachining(big)).toBe(false);
  });

  it("changes a rest operation's key when an operation before it changes", () => {
    const changed = { ...big, tool: { ...bigMill, diameter: 8 } };
    expect(key([changed, small], 1)).not.toBe(key([big, small], 1));
    // Disabling it changes what is left too.
    expect(key([{ ...big, enabled: false }, small], 1)).not.toBe(key([big, small], 1));
    // Renaming it doesn't.
    expect(key([{ ...big, name: "Renamed" }, small], 1)).toBe(key([big, small], 1));
  });

  it("keeps keys linear in the operations before it, however many rest operations chain", () => {
    const chain = Array.from({ length: 20 }, () => roughing(smallMill, { rest: true }));
    const inputs = toolpathInputs(project(chain));
    const one = toolpathKey(inputs[0] as never).length;
    const last = toolpathKey(inputs.at(-1) as never).length;
    expect(last).toBeLessThan(25 * one);
  });

  it("leaves other operations' keys alone", () => {
    const plain = roughing(smallMill);
    const changed = { ...big, tool: { ...bigMill, diameter: 8 } };
    expect(key([changed, plain], 1)).toBe(key([big, plain], 1));
    // Nor does an operation after a rest operation change its key.
    expect(key([small, changed], 0)).toBe(key([small, big], 0));
  });
});
