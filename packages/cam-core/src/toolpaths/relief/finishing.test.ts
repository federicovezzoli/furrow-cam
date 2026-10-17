import type {
  FinishingStrategy,
  Model,
  Point,
  ReliefFinishOperation,
  Tool,
} from "@furrow/document";
import { ballEndMill, endMill, model as modelFixture, vBit } from "@furrow/document/fixtures";
import { describe, expect, it } from "vitest";
import { signedArea } from "../../geometry/clipper";
import { cutterProfile, simulateCuts } from "../../simulation/simulation";
import type { Toolpath, ToolpathMove } from "../toolpath";
import {
  modelHeightsSteps,
  reliefGrid,
  runSteps,
  ToolDropper,
  widened as widenedProfile,
} from "./finish";
import { reliefFinishSteps } from "./finishing";
import { type SpiralRun, spiralRuns } from "./spiral";
import { isoLines, tipHeightsSteps } from "./waterline";

/** A horizontal rectangle at height `z`, as two triangles. */
function rect(x0: number, y0: number, x1: number, y1: number, z: number): number[] {
  return [x0, y0, z, x1, y0, z, x1, y1, z, x0, y0, z, x1, y1, z, x0, y1, z];
}

/** A vertical wall along Y at `x`, from `z0` up to `z1`: seen edge-on from above. */
function wall(x: number, y0: number, y1: number, z0: number, z1: number): number[] {
  return [x, y0, z0, x, y1, z0, x, y1, z1, x, y0, z0, x, y1, z1, x, y0, z1];
}

/** A model whose mesh coordinates are its stock coordinates, its top at the stock top. */
function placed(width: number, length: number, depth: number): Model {
  return {
    ...modelFixture,
    bounds: { min: [0, 0, -depth], max: [width, length, 0] },
    placement: { rotation: [0, 0, 0], scale: 1, depth, position: [0, 0] },
  };
}

/** A 20 × 10 × 10 model: a plateau 4 mm below the top over x < 10, the floor at -10 beyond. */
const STEP = placed(20, 10, 10);
const stepMesh = new Float32Array([
  ...rect(0, 0, 20, 10, -10),
  ...rect(0, 0, 10, 10, -4),
  ...wall(10, 0, 10, -10, -4),
  ...rect(19.99, 9.99, 20, 10, 0),
]);

/** A 20 × 20 pyramid, 8 mm high, its apex at the stock top. */
const PYRAMID = placed(20, 20, 8);
const pyramidMesh = new Float32Array([
  ...[0, 0, -8, 20, 0, -8, 10, 10, 0],
  ...[20, 0, -8, 20, 20, -8, 10, 10, 0],
  ...[20, 20, -8, 0, 20, -8, 10, 10, 0],
  ...[0, 20, -8, 0, 0, -8, 10, 10, 0],
]);

function finishing(
  tool: Tool,
  strategy: FinishingStrategy,
  params: Partial<ReliefFinishOperation["params"]> = {},
): ReliefFinishOperation {
  return {
    id: "7c1e4b2a-9d3f-4a6e-8b5c-2f0e1d9a8b7c",
    type: "relief_finish",
    name: "Finish",
    enabled: true,
    targets: [],
    tool,
    params: { modelId: STEP.id, strategy, stepOver: 20, stockToLeave: 0, rest: false, ...params },
  };
}

const options = { safeZ: 5, entryClearance: 1 };

function finish(
  tool: Tool,
  strategy: FinishingStrategy,
  params: Partial<ReliefFinishOperation["params"]> = {},
  model = STEP,
  mesh = stepMesh,
): Toolpath {
  return runSteps(reliefFinishSteps(finishing(tool, strategy, params), model, mesh, options));
}

type Feed = Extract<ToolpathMove, { kind: "feed" }>;
const cuts = ({ moves }: Toolpath, tool: Tool) =>
  moves.filter((move): move is Feed => move.kind === "feed" && move.feedRate === tool.feedRate);

/** Fails if the stock after `toolpath` is anywhere below the model offset by `stockToLeave`. */
/**
 * Tools are dropped onto cell centres (ADR-0030), so a cutter's rim may reach
 * up to a cell's worth of a slope between them, as with parallel passes: the
 * pyramid's faces rise 0.8 in 1, over 0.1 mm cells.
 */
const SAMPLING = 0.8 * 0.1 + 0.005;

/** Fails if the stock after `toolpath` is anywhere more than `tolerance` below the model offset by `stockToLeave`. */
function expectNoGouge(
  toolpath: Toolpath,
  tool: Tool,
  model: Model,
  mesh: Float32Array,
  { stockToLeave = 0, tolerance = 1e-3 } = {},
) {
  // The models used here sit at the stock's corner.
  const [width, length] = model.bounds.max;
  const columns = Math.round(width / 0.1);
  const rows = Math.round(length / 0.1);
  const segments: number[] = [];
  const { moves } = toolpath;
  for (let i = 1; i < moves.length; i++) {
    segments.push(...(moves[i - 1]?.to ?? []), ...(moves[i]?.to ?? []));
  }
  const stock = simulateCuts(
    { width, height: length, thickness: 20 },
    [{ tool, segments: new Float32Array(segments) }],
    { columns, rows, cellWidth: 0.1, cellHeight: 0.1 },
  );
  const grid = reliefGrid(model, 0, 0.1);
  if (!grid) throw new Error("no grid");
  const heights = runSteps(modelHeightsSteps(model, mesh, grid, stockToLeave, undefined));
  let worst = Infinity;
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const cell = row * grid.columns + column;
      worst = Math.min(
        worst,
        (stock.heights[row * columns + column] as number) - Math.min(0, heights[cell] as number),
      );
    }
  }
  if (worst < -tolerance) {
    for (let row = 0; row < rows; row++)
      for (let column = 0; column < columns; column++) {
        const d =
          (stock.heights[row * columns + column] as number) -
          Math.min(0, heights[row * grid.columns + column] as number);
        if (d === worst)
          console.log(
            "DBG",
            tool.type,
            (column + 0.5) * 0.1,
            (row + 0.5) * 0.1,
            heights[row * grid.columns + column],
            stock.heights[row * columns + column],
          );
      }
  }
  expect(worst).toBeGreaterThanOrEqual(-tolerance);
  return stock;
}

/** The distance from `point` to the polyline through `points`. */
function distanceTo(points: readonly Point[], [x, y]: Point): number {
  let best = Infinity;
  for (let i = 1; i < points.length; i++) {
    const [ax, ay] = points[i - 1] as Point;
    const [bx, by] = points[i] as Point;
    const length2 = (bx - ax) ** 2 + (by - ay) ** 2;
    const t =
      length2 > 0
        ? Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / length2))
        : 0;
    best = Math.min(best, Math.hypot(x - ax - t * (bx - ax), y - ay - t * (by - ay)));
  }
  return best;
}

describe("isoLines", () => {
  const grid = { columns: 3, rows: 3, cellWidth: 1, cellHeight: 1 };

  it("rings a cell above the level, clockwise so it is on the right", () => {
    const lines = isoLines([0, 0, 0, 0, 4, 0, 0, 0, 0], grid, 1);
    expect(lines).toHaveLength(1);
    const [line] = lines;
    expect(line?.closed).toBe(true);
    expect(line?.points).toHaveLength(4);
    expect(signedArea(line?.points ?? [])).toBeLessThan(0);
    // A quarter of the way from the centre to each neighbour.
    for (const [x, y] of line?.points ?? []) {
      expect(Math.abs(x - 1.5) + Math.abs(y - 1.5)).toBeCloseTo(0.75);
    }
  });

  it("leaves the grid open at its edge", () => {
    const lines = isoLines([5, 5, 0, 5, 5, 0, 5, 5, 0], grid, 1);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.closed).toBe(false);
    // Straight down between the second and third columns, the high side on the right.
    expect(lines[0]?.points.map(([x, y]) => [x, y])).toEqual([
      [expect.closeTo(2.3, 1), 2.5],
      [expect.closeTo(2.3, 1), 0.5],
    ]);
  });

  it("joins a saddle's corners above through its centre, or keeps them apart", () => {
    const square = { columns: 2, rows: 2, cellWidth: 1, cellHeight: 1 };
    const above: Point[] = [
      [0.5, 0.5],
      [1.5, 1.5],
    ];
    const below: Point[] = [
      [1.5, 0.5],
      [0.5, 1.5],
    ];
    /** Whether each segment cuts off one of `corners`: its middle nearer to it than to the others. */
    const cutsOff = (lines: { points: [number, number][] }[], corners: Point[], others: Point[]) =>
      lines.every(({ points: [a, b] }) => {
        const middle: Point = [
          ((a?.[0] ?? 0) + (b?.[0] ?? 0)) / 2,
          ((a?.[1] ?? 0) + (b?.[1] ?? 0)) / 2,
        ];
        const near = (points: Point[]) =>
          Math.min(...points.map(([x, y]) => Math.hypot(x - middle[0], y - middle[1])));
        return near(corners) < near(others);
      });
    // Corners above at the bottom-left and the top-right; their mean decides.
    const apart = isoLines([1.5, 0, 0, 1.5], square, 1);
    expect(apart).toHaveLength(2);
    expect(cutsOff(apart, above, below)).toBe(true);
    const joined = isoLines([4, 0, 0, 4], square, 1);
    expect(joined).toHaveLength(2);
    expect(cutsOff(joined, below, above)).toBe(true);
  });

  it("keeps the moves between points clear of the model, not only the points", () => {
    // A pillar on coarse 0.5 mm cells, where straight moves around its
    // corners would sag into the flat end mill's reach.
    const pillar = placed(12, 12, 8);
    const mesh = new Float32Array([...rect(0, 0, 12, 12, -8), ...rect(5, 5, 7, 7, 0)]);
    const grid = reliefGrid(pillar, 0, 0.5);
    if (!grid) throw new Error("no grid");
    const heights = runSteps(modelHeightsSteps(pillar, mesh, grid, 0, undefined));
    const dropper = new ToolDropper(heights, grid, cutterProfile(endMill));
    const tips = runSteps(tipHeightsSteps({ grid, dropper, floor: -8 }));
    const widened = new ToolDropper(heights, grid, widenedProfile(cutterProfile(endMill), 0.001));
    const lines = isoLines(tips, grid, -4, { exact: dropper, widened });
    expect(lines.length).toBeGreaterThan(0);
    for (const { points, closed } of lines) {
      const count = closed ? points.length : points.length - 1;
      for (let i = 0; i < count; i++) {
        const [ax, ay] = points[i] as Point;
        const [bx, by] = points[(i + 1) % points.length] as Point;
        for (let k = 0; k <= 20; k++) {
          const tip = dropper.dropPoint(ax + ((bx - ax) * k) / 20, ay + ((by - ay) * k) / 20, -8);
          expect(tip).toBeLessThanOrEqual(-4 + 1e-5);
        }
      }
    }
  });

  it("is empty where nothing crosses the level", () => {
    expect(isoLines([0, 0, 0, 0, 0, 0, 0, 0, 0], grid, 1)).toEqual([]);
    expect(isoLines([5, 5, 5, 5, 5, 5, 5, 5, 5], grid, 1)).toEqual([]);
  });
});

describe("waterline", () => {
  const waterline = (stepDown: number) => ({ type: "waterline", stepDown }) as const;

  it("cuts every contour at constant Z, on the levels", () => {
    const toolpath = finish(ballEndMill, waterline(1), {}, PYRAMID, pyramidMesh);
    expect(toolpath.warnings).toEqual([]);
    const levels = new Set([-1, -2, -3, -4, -5, -6, -7, -8].map((z) => z.toFixed(6)));
    const feeds = cuts(toolpath, ballEndMill);
    expect(feeds.length).toBeGreaterThan(0);
    for (const { to } of feeds) expect(levels).toContain(to[2].toFixed(6));
    // Each level is cut, the higher ones first.
    const zs = feeds.map(({ to }) => to[2]);
    for (let i = 1; i < zs.length; i++)
      expect(zs[i]).toBeLessThanOrEqual((zs[i - 1] as number) + 1e-9);
  });

  for (const [label, tool, tolerance] of [
    ["a ball end mill", ballEndMill, 0.005],
    ["a flat end mill", endMill, SAMPLING],
    ["a V-bit", { ...vBit, diameter: 12 }, SAMPLING],
  ] as const) {
    it(`never cuts below the model, with ${label}`, () => {
      const toolpath = finish(tool, waterline(0.5), {}, PYRAMID, pyramidMesh);
      expectNoGouge(toolpath, tool, PYRAMID, pyramidMesh, { tolerance });
    });
  }

  it("never cuts below the offset model, leaving the stock to leave", () => {
    const toolpath = finish(ballEndMill, waterline(1), { stockToLeave: 0.5 }, PYRAMID, pyramidMesh);
    expectNoGouge(toolpath, ballEndMill, PYRAMID, pyramidMesh, {
      stockToLeave: 0.5,
      tolerance: 0.005,
    });
  });

  it("never cuts into a sharp raised feature", () => {
    // A 1.8 × 1.8 mm pillar, its top at the stock top, on a floor 8 mm down.
    // Its edges are on cell edges of both the toolpaths' grids (0.1 and
    // 0.075 mm) and the simulation's, which see the same pillar.
    const pillar = placed(12, 12, 8);
    const mesh = new Float32Array([...rect(0, 0, 12, 12, -8), ...rect(5.1, 5.1, 6.9, 6.9, 0)]);
    for (const tool of [endMill, ballEndMill]) {
      const toolpath = finish(tool, waterline(0.5), {}, pillar, mesh);
      expect(cuts(toolpath, tool).length).toBeGreaterThan(0);
      expectNoGouge(toolpath, tool, pillar, mesh);
    }
  });

  it("puts contours a step-down apart on a steep wall, climb milling along it", () => {
    const toolpath = finish(endMill, waterline(1));
    const r = endMill.diameter / 2;
    const beside = cuts(toolpath, endMill).filter(({ to }) => Math.abs(to[0] - (10 + r)) < 0.2);
    const zs = [...new Set(beside.map(({ to }) => to[2].toFixed(6)))].map(Number);
    // The wall runs from the plateau at -4 down to the floor at -10.
    expect(zs).toEqual([-5, -6, -7, -8, -9, -10]);
    // The model on the right: along the wall towards -Y.
    const level = beside.filter(({ to }) => Math.abs(to[2] + 7) < 1e-9);
    expect((level[0]?.to[1] as number) > (level.at(-1)?.to[1] as number)).toBe(true);
    expectNoGouge(toolpath, endMill, STEP, stepMesh, { tolerance: SAMPLING });
  });

  it("cuts the middle of a straight contour the earlier operations left, with rest machining", () => {
    // Earlier cuts along the wall's contours at both ends only, as far as y = 3 and from y = 7.
    const x = 10 + endMill.diameter / 2;
    const segments: number[] = [];
    for (let z = -5; z >= -10; z--) segments.push(x, 0, z, x, 3, z, x, 7, z, x, 10, z);
    const toolpath = runSteps(
      reliefFinishSteps(finishing(endMill, waterline(1), { rest: true }), STEP, stepMesh, {
        ...options,
        rest: { cuts: [{ tool: endMill, segments: new Float32Array(segments) }], stock: null },
      }),
    );
    const middle = cuts(toolpath, endMill).filter(
      ({ to }) => Math.abs(to[0] - x) < 0.2 && to[1] > 3.5 && to[1] < 6.5,
    );
    expect(middle.length).toBeGreaterThan(0);
  });

  it("cuts nothing after the same finishing, with rest machining", () => {
    const first = finish(ballEndMill, waterline(1), {}, PYRAMID, pyramidMesh);
    const restOptions = {
      ...options,
      rest: { cuts: [{ tool: ballEndMill, segments: segmentsOf(first) }], stock: null },
    };
    const again = runSteps(
      reliefFinishSteps(
        finishing(ballEndMill, waterline(1), { rest: true }),
        PYRAMID,
        pyramidMesh,
        restOptions,
      ),
    );
    expect(cuts(again, ballEndMill).length).toBeLessThan(cuts(first, ballEndMill).length / 10);
  });
});

function segmentsOf({ moves }: Toolpath): Float32Array {
  const segments: number[] = [];
  for (let i = 1; i < moves.length; i++) {
    segments.push(...(moves[i - 1]?.to ?? []), ...(moves[i]?.to ?? []));
  }
  return new Float32Array(segments);
}

describe("spiralRuns", () => {
  /** The cell centres the runs pass through, in order, as points of a 1 × 1 grid. */
  const path = (runs: SpiralRun[]) =>
    runs.flatMap(({ along, line, from, to }) => {
      const cells: Point[] = [];
      for (let k = 0; k <= Math.abs(to - from); k++) {
        const cell = from + (to < from ? -k : k);
        cells.push(along === "row" ? [cell, line] : [line, cell]);
      }
      return cells;
    });

  for (const [columns, rows, across, down] of [
    [40, 25, 3, 3],
    [25, 40, 4, 2],
    [30, 30, 5, 5],
    [12, 3, 2, 2],
    [7, 7, 1, 1],
  ] as const) {
    it(`covers ${columns} × ${rows} cells, laps ${across} × ${down} apart, in one go`, () => {
      const runs = spiralRuns(columns, rows, across, down);
      const cells = path(runs);
      expect(cells[0]).toEqual([0, 0]);
      // Each run starts where the one before ends, a cell's step at a time.
      for (let i = 1; i < cells.length; i++) {
        const [ax, ay] = cells[i - 1] as Point;
        const [bx, by] = cells[i] as Point;
        expect(Math.abs(bx - ax) + Math.abs(by - ay)).toBeLessThanOrEqual(1);
      }
      for (let x = 0; x < columns; x++) {
        for (let y = 0; y < rows; y++) {
          // Half a step between laps, more in the corners between them.
          expect(distanceTo(cells, [x, y])).toBeLessThanOrEqual(
            Math.max(across, down) * Math.SQRT1_2 + 1e-9,
          );
        }
      }
    });
  }
});

describe("spiral", () => {
  const spiral = (start: "outside" | "centre") => ({ type: "spiral", start }) as const;

  it("cuts in one go, its laps a step-over apart over the outline", () => {
    const toolpath = finish(ballEndMill, spiral("outside"), {}, PYRAMID, pyramidMesh);
    // Down once, up once.
    const rapids = toolpath.moves.filter(({ kind }) => kind === "rapid");
    expect(rapids).toHaveLength(3);
    const path = toolpath.moves
      .filter(({ kind }) => kind === "feed")
      .map(({ to }): Point => [to[0], to[1]]);
    const spacing = (ballEndMill.diameter * 20) / 100;
    const cell = 0.075;
    for (let x = 0; x <= 20; x += 0.25) {
      for (let y = 0; y <= 20; y += 0.25) {
        expect(distanceTo(path, [x, y])).toBeLessThanOrEqual(spacing * Math.SQRT1_2 + cell);
      }
    }
    // It starts at the outline's corner, on the first cell's centre.
    expect(path[0]?.[0]).toBeLessThan(0.05);
    expect(path[0]?.[1]).toBeLessThan(0.05);
  });

  it("starts in the middle", () => {
    const path = cuts(finish(ballEndMill, spiral("centre"), {}, PYRAMID, pyramidMesh), ballEndMill);
    const [x, y] = path[0]?.to ?? [0, 0];
    expect(Math.hypot(x - 10, y - 10)).toBeLessThan(1);
    expect(path.at(-1)?.to[0]).toBeLessThan(0.05);
  });

  for (const [label, tool, tolerance] of [
    ["a ball end mill", ballEndMill, 0.005],
    ["a flat end mill", endMill, SAMPLING],
  ] as const) {
    it(`never cuts below the model, with ${label}`, () => {
      const toolpath = finish(tool, spiral("outside"), {}, PYRAMID, pyramidMesh);
      expectNoGouge(toolpath, tool, PYRAMID, pyramidMesh, { tolerance });
      expectNoGouge(finish(tool, spiral("centre")), tool, STEP, stepMesh, { tolerance });
    });
  }

  it("cuts nothing after the same finishing, with rest machining", () => {
    const first = finish(ballEndMill, spiral("outside"), {}, PYRAMID, pyramidMesh);
    const again = runSteps(
      reliefFinishSteps(
        finishing(ballEndMill, spiral("outside"), { rest: true }),
        PYRAMID,
        pyramidMesh,
        {
          ...options,
          rest: { cuts: [{ tool: ballEndMill, segments: segmentsOf(first) }], stock: null },
        },
      ),
    );
    expect(cuts(again, ballEndMill).length).toBeLessThan(cuts(first, ballEndMill).length / 10);
  });
});
