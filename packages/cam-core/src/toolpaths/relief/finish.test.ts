import type { Model, ReliefFinishOperation, Tool } from "@furrow/document";
import { ballEndMill, endMill, model as modelFixture, vBit } from "@furrow/document/fixtures";
import { describe, expect, it } from "vitest";
import { modelView } from "../../scene/sides";
import { cutterProfile } from "../../simulation/simulation";
import { generateToolpath, MissingMeshError, type ToolpathInput, toolpathKey } from "../generate";
import type { Toolpath, ToolpathMove } from "../toolpath";
import {
  createReliefCache,
  MAX_RELIEF_CELLS,
  offsetHeightsSteps,
  type ReliefGrid,
  RestDropper,
  rasterizeModelSteps,
  reachModel,
  reliefCacheKey,
  reliefCellSize,
  reliefGrid,
  restGrid,
  restProfile,
  runSteps,
  sampleMoves,
  simplifyHeights,
  ToolDropper,
} from "./finish";
import { reliefFinishSteps } from "./finishing";

/** A horizontal rectangle at height `z`, as two triangles. */
function rect(x0: number, y0: number, x1: number, y1: number, z: number): number[] {
  return [x0, y0, z, x1, y0, z, x1, y1, z, x0, y0, z, x1, y1, z, x0, y1, z];
}

/** A rectangle from `[x0, y0, z0]` to `[x1, y1, z1]` that slopes along X. */
function ramp(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): number[] {
  return [x0, y0, z0, x1, y0, z1, x1, y1, z1, x0, y0, z0, x1, y1, z1, x0, y1, z0];
}

/** A vertical wall along Y at `x`, from `z0` up to `z1`: seen edge-on from above. */
function wall(x: number, y0: number, y1: number, z0: number, z1: number): number[] {
  return [x, y0, z0, x, y1, z0, x, y1, z1, x, y0, z0, x, y1, z1, x, y0, z1];
}

/**
 * A model whose mesh coordinates are its stock coordinates: `width` × `length`,
 * its top at the stock top and `depth` deep, at the stock's corner.
 */
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
  // A point of the box at the stock top, so the bounds are what the mesh holds.
  ...rect(19.99, 9.99, 20, 10, 0),
]);

function finishing(
  tool: Tool,
  params: Partial<ReliefFinishOperation["params"]> = {},
): ReliefFinishOperation {
  return {
    id: "7c1e4b2a-9d3f-4a6e-8b5c-2f0e1d9a8b7c",
    type: "relief_finish",
    name: "Finish",
    enabled: true,
    stockSide: "top",
    targets: [],
    tool,
    params: {
      modelId: STEP.id,
      strategy: { type: "parallel", angle: 0, direction: "zigzag" },
      stepOver: 50,
      stockToLeave: 0,
      boundary: { type: "model" },
      rest: false,
      ...params,
    },
  };
}

const options = { safeZ: 5, entryClearance: 1 };

function parallel(angle: number, direction: "one_way" | "zigzag") {
  return { type: "parallel", angle, direction } as const;
}

function finish(
  tool: Tool,
  params: Partial<ReliefFinishOperation["params"]> = {},
  model = STEP,
  mesh = stepMesh,
): Toolpath {
  return runSteps(reliefFinishSteps(finishing(tool, params), model, mesh, options));
}

type Feed = Extract<ToolpathMove, { kind: "feed" }>;
const feeds = ({ moves }: Toolpath) =>
  moves.filter((move): move is Feed => move.kind === "feed" && move.feedRate === 1500);

describe("reliefCellSize", () => {
  it("is 0.1 mm, or a twentieth of the tool's radius if smaller", () => {
    expect(reliefCellSize({ diameter: 6 })).toBe(0.1);
    expect(reliefCellSize({ diameter: 3 })).toBeCloseTo(0.075);
  });
});

describe("reliefGrid", () => {
  it("covers the model's outline with cells of the wanted size", () => {
    const grid = reliefGrid(modelView(placed(300, 200, 10)), 0, 0.075);
    expect(grid).toMatchObject({ columns: 4000, rows: 2667, coarsened: false, base: -10 });
    expect(grid?.outline).toEqual([
      [0, 0],
      [300, 0],
      [300, 200],
      [0, 200],
    ]);
  });

  it("grows the cells to stay within the cap, and says so", () => {
    const grid = reliefGrid(modelView(placed(600, 400, 10)), 0, 0.075);
    if (!grid) throw new Error("no grid");
    expect(grid.coarsened).toBe(true);
    expect(grid.columns * grid.rows).toBeLessThanOrEqual(MAX_RELIEF_CELLS);
    expect(grid.cellWidth).toBeGreaterThan(0.075);
  });

  it("is laid out along the passes", () => {
    const grid = reliefGrid(modelView(placed(20, 10, 5)), 90, 0.5);
    // Turned a quarter turn, the outline is 10 wide and 20 long.
    expect(grid?.columns).toBe(20);
    expect(grid?.rows).toBe(40);
  });

  it("is null for a model with no area", () => {
    expect(
      reliefGrid(
        modelView({ ...placed(20, 10, 5), bounds: { min: [0, 0, 0], max: [0, 10, 5] } }),
        0,
        0.1,
      ),
    ).toBeNull();
  });
});

describe("reliefCacheKey", () => {
  it("tells grids with the same corner and cells of different sizes apart", () => {
    const view = modelView(placed(300.02, 200, 10));
    const wider = modelView(placed(300.07, 200, 10));
    const a = reliefGrid(view, 0, 0.1);
    const b = reliefGrid(wider, 0, 0.1);
    if (!a || !b) throw new Error("no grid");
    expect([a.columns, a.rows, a.origin]).toEqual([b.columns, b.rows, b.origin]);
    expect(reliefCacheKey(view, a, 0)).not.toBe(reliefCacheKey(view, b, 0));
  });
});

describe("restGrid", () => {
  const grid = reliefGrid(modelView(placed(20, 10, 5)), 0, 0.1);
  if (!grid) throw new Error("no grid");

  it("covers the operation's grid with cells of at least a quarter millimetre", () => {
    expect(restGrid(grid)).toMatchObject({
      origin: grid.origin,
      columns: 80,
      rows: 40,
      cellWidth: 0.25,
      cellHeight: 0.25,
      coarsened: false,
    });
  });

  it("grows to cover an area past the grid, in the grid's frame", () => {
    const rest = restGrid(grid, { min: [-5, 2], max: [30, 4] });
    expect(rest.origin).toEqual([-5, 0]);
    expect([rest.columns, rest.rows]).toEqual([140, 40]);
    // The outline stays on the model.
    expect(rest.outline[0]).toEqual([5, 0]);
  });

  it("grows its cells to stay within the cap", () => {
    const rest = restGrid(grid, { min: [-1000, -1000], max: [1000, 1000] }, 10_000);
    expect(rest.columns * rest.rows).toBeLessThanOrEqual(10_000);
    expect(rest.columns * rest.cellWidth).toBeCloseTo(2000);
    // Said, so rest roughing can warn that narrow material may be missed.
    expect(rest.coarsened).toBe(true);
    expect(restGrid(grid, { min: [-5, 2], max: [30, 4] }).coarsened).toBe(false);
  });
});

describe("RestDropper", () => {
  it("drops along a pass as each sample's own drop would, skipping the cleared stretches", () => {
    const grid = reliefGrid(modelView(placed(20, 10, 5)), 0, 0.1);
    if (!grid) throw new Error("no grid");
    const coarse = restGrid(grid, { min: [-5, -5], max: [30, 15] });
    // Mostly cleared to -5, with a few spots of stock left at varying heights.
    const heights = new Float32Array(coarse.columns * coarse.rows).fill(-5);
    for (let k = 0; k < heights.length; k += 997) heights[k] = -5 + (k % 7);
    const profile = cutterProfile({ ...endMill, diameter: 3 });
    const dropper = new RestDropper({ grid: coarse, heights }, grid, profile);
    const exact = new ToolDropper(heights, coarse, restProfile(profile));
    const [du, dv] = [grid.origin[0] - coarse.origin[0], grid.origin[1] - coarse.origin[1]];
    for (const v of [0.05, 2.35, 5, 9.95]) {
      const out = new Float64Array(grid.columns).fill(-4.5);
      dropper.dropLine(v, 0, grid.columns - 1, out);
      for (let i = 0; i < grid.columns; i++) {
        const u = (i + 0.5) * grid.cellWidth + du;
        expect(out[i]).toBe(exact.dropPoint(u, v + dv, -4.5));
      }
    }
  });
});

function raster(model: Model, mesh: Float32Array, cell = 1, angle = 0) {
  const grid = reliefGrid(modelView(model), angle, cell);
  if (!grid) throw new Error("no grid");
  return { grid, heights: runSteps(rasterizeModelSteps(mesh, modelView(model), grid)) };
}

describe("rasterizeModelSteps", () => {
  it("draws flat, sloped and vertical faces, the floor where nothing covers it", () => {
    const { grid, heights } = raster(STEP, stepMesh);
    const row = Array.from(heights.subarray(0, grid.columns));
    expect(row.slice(0, 10)).toEqual(Array(10).fill(-4));
    expect(row.slice(10, 19)).toEqual(Array(9).fill(-10));

    const slope = placed(10, 2, 10);
    const sloped = raster(slope, new Float32Array(ramp(0, 0, -10, 10, 2, 0)));
    expect(Array.from(sloped.heights.subarray(0, 10))).toEqual([
      -9.5, -8.5, -7.5, -6.5, -5.5, -4.5, -3.5, -2.5, -1.5, -0.5,
    ]);
  });

  it("fills undercuts: only the highest surface over a cell counts", () => {
    // A mushroom: a cap at -2 over a stem, above a floor at -10.
    const mushroom = placed(10, 10, 10);
    const mesh = new Float32Array([
      ...rect(0, 0, 10, 10, -10),
      ...rect(2, 2, 8, 8, -2),
      // The cap's underside, facing down, at -3.
      ...rect(2, 2, 8, 8, -3),
      ...rect(4, 4, 6, 6, -9),
      ...rect(9.99, 9.99, 10, 10, 0),
    ]);
    const { grid, heights } = raster(mushroom, mesh);
    expect(heights[5 * grid.columns + 5]).toBe(-2);
    expect(heights[5 * grid.columns + 2]).toBe(-2);
    expect(heights[5 * grid.columns + 1]).toBe(-10);
  });

  it("rasterises in the passes' frame", () => {
    const { grid, heights } = raster(STEP, stepMesh, 1, 90);
    // Passes along Y follow each other towards -X: the plateau is in the last rows.
    expect(heights[15 * grid.columns + 5]).toBe(-4);
    expect(heights[5 * grid.columns + 5]).toBe(-10);
  });
});

describe("offsetHeightsSteps", () => {
  it("raises flat faces and moves vertical walls out by the distance", () => {
    const { grid, heights } = raster(STEP, stepMesh, 0.25);
    const offset = runSteps(offsetHeightsSteps(heights, grid, 1));
    const at = (x: number) => offset[20 * grid.columns + Math.floor(x / 0.25)] as number;
    expect(at(5)).toBeCloseTo(-3);
    expect(at(15)).toBeCloseTo(-9);
    // Beside the wall at x = 10, a sphere around the plateau's last cell, centred at 9.875.
    expect(at(10.125)).toBeCloseTo(-4 + Math.sqrt(1 - 0.25 ** 2), 5);
    expect(at(10.625)).toBeCloseTo(-4 + Math.sqrt(1 - 0.75 ** 2), 5);
    expect(at(11.125)).toBeCloseTo(-9);
  });

  it("leaves the heights alone with no distance", () => {
    const { grid, heights } = raster(STEP, stepMesh);
    expect(runSteps(offsetHeightsSteps(heights, grid, 0))).toBe(heights);
  });
});

describe("ToolDropper", () => {
  const { grid, heights } = raster(STEP, stepMesh, 0.1);
  const drop = (tool: Tool, x: number) => {
    const dropper = new ToolDropper(heights, grid, cutterProfile(tool));
    const column = Math.floor(x / 0.1);
    const line = new Float64Array(1).fill(-10);
    dropper.dropLine(5, column, column, line);
    const point = dropper.dropPoint((column + 0.5) * 0.1, 5, -10);
    expect(point).toBeCloseTo(line[0] as number, 9);
    return line[0] as number;
  };

  it("keeps a flat end mill on the plateau until it clears the wall", () => {
    const radius = endMill.diameter / 2;
    expect(drop(endMill, 5)).toBe(-4);
    expect(drop(endMill, 10 + radius - 0.2)).toBe(-4);
    expect(drop(endMill, 10 + radius + 0.2)).toBe(-10);
  });

  it("rolls a ball end mill over the wall's edge", () => {
    const tool = { ...ballEndMill, diameter: 6 };
    // The sphere touches the plateau's last cell, centred at 9.95: the tip is
    // r − √(r² − d²) below it.
    const d = 12.05 - 9.95;
    expect(drop(tool, 12)).toBeCloseTo(-4 - (3 - Math.sqrt(9 - d * d)), 1);
    expect(drop(tool, 14)).toBe(-10);
  });

  it("lowers a V-bit along its cone past the wall", () => {
    // A 60° V-bit rises 1/tan(30°) per millimetre from its axis.
    const tool = { ...vBit, diameter: 12 };
    const slope = 1 / Math.tan(Math.PI / 6);
    expect(drop(tool, 11)).toBeCloseTo(-4 - 1.1 * slope, 1);
    expect(drop(tool, 15)).toBe(-10);
  });
});

describe("simplifyHeights", () => {
  it("merges samples on a straight line", () => {
    expect(simplifyHeights([0, 1, 2, 3, 4], 0.01)).toEqual([0, 4]);
    expect(simplifyHeights([0, 0, 0, 1, 2], 0.01)).toEqual([0, 2, 4]);
  });

  it("never passes below a sample, and at most the tolerance above", () => {
    const heights = Array.from({ length: 200 }, (_, i) => Math.sin(i / 10) * 3);
    const kept = simplifyHeights(heights, 0.01);
    expect(kept.length).toBeLessThan(200);
    for (let k = 1; k < kept.length; k++) {
      const a = kept[k - 1] as number;
      const b = kept[k] as number;
      for (let i = a; i <= b; i++) {
        const chord =
          (heights[a] as number) +
          (((heights[b] as number) - (heights[a] as number)) * (i - a)) / (b - a);
        expect(chord).toBeGreaterThanOrEqual((heights[i] as number) - 1e-9);
        expect(chord).toBeLessThanOrEqual((heights[i] as number) + 0.01 + 1e-9);
      }
    }
  });
});

describe("sampleMoves", () => {
  it("merges gentle samples like simplifyHeights", () => {
    expect(sampleMoves([0, 0.1, 0.2, 0.3], 1)).toEqual([
      [0, 0],
      [3, 0.3],
    ]);
  });

  it("goes over at the higher sample where the tool drops off a wall", () => {
    expect(sampleMoves([-4, -4, -10, -10], 0.1)).toEqual([
      [0, -4],
      [1, -4],
      [2, -4],
      [2, -10],
      [3, -10],
    ]);
    // Climbing: straight up, then along.
    expect(sampleMoves([-10, -4], 0.1)).toEqual([
      [0, -10],
      [0, -4],
      [1, -4],
    ]);
  });

  it("climbs straight up from the first sample", () => {
    // The tool is at the first sample: the climb starts there, before any move along.
    expect(sampleMoves([-10, -4, -4], 0.1).slice(0, 3)).toEqual([
      [0, -10],
      [0, -4],
      [1, -4],
    ]);
  });

  it("follows the tool between steep samples where it can drop it there", () => {
    // A wall at a quarter of the way between the samples.
    const between = (_: number, fraction: number) => (fraction <= 0.25 ? -4 : -10);
    const moves = sampleMoves([-4, -10], 0.1, between);
    // Along at -4 only to the wall, not to the next sample.
    expect(moves.filter(([, z]) => z === -4).at(-1)?.[0]).toBeLessThanOrEqual(0.25 + 1 / 16);
    expect(moves.at(-1)).toEqual([1, -10]);
  });
});

describe("reliefFinishSteps", () => {
  it("follows the model with a flat end mill", () => {
    const toolpath = finish(endMill);
    expect(toolpath.warnings).toEqual([]);
    const zs = feeds(toolpath).map(({ to }) => to[2]);
    expect(Math.max(...zs)).toBeCloseTo(-4);
    expect(Math.min(...zs)).toBeCloseTo(-10);
    // Clear of the wall by the radius, it reaches the floor.
    for (const { to } of feeds(toolpath)) {
      if (to[0] > 10 + endMill.diameter / 2 + 0.1) expect(to[2]).toBeCloseTo(-10);
      if (to[0] < 10) expect(to[2]).toBeCloseTo(-4);
    }
  });

  it("follows a slope with a ball end mill, offset along its normal", () => {
    const slope = placed(20, 4, 10);
    const mesh = new Float32Array(ramp(0, 0, -10, 20, 4, 0));
    const toolpath = finish(ballEndMill, {}, slope, mesh);
    const r = ballEndMill.diameter / 2;
    // On a plane rising 1 in 2 the sphere's centre is r·√(1 + ½²) above it.
    const lift = r * (Math.sqrt(1 + 0.25) - 1);
    for (const { to } of feeds(toolpath)) {
      if (to[0] < r + 0.1 || to[0] > 20 - r - 0.1) continue;
      expect(to[2]).toBeCloseTo(-10 + to[0] / 2 + lift, 1);
    }
  });

  it("carves past the wall with a V-bit", () => {
    const tool = { ...vBit, diameter: 12 };
    const zs = feeds(finish(tool)).map(({ to }) => to[2]);
    expect(Math.max(...zs)).toBeCloseTo(-4);
    expect(Math.min(...zs)).toBeCloseTo(-10);
  });

  it("leaves the stock to leave on every face", () => {
    const zs = feeds(finish(endMill, { stockToLeave: 0.5 })).map(({ to }) => to[2]);
    expect(Math.max(...zs)).toBeCloseTo(-3.5);
    expect(Math.min(...zs)).toBeCloseTo(-9.5);
  });

  it("cuts no deeper than the stock's bottom, and says so", () => {
    const steps = reliefFinishSteps(finishing(endMill), STEP, stepMesh, {
      ...options,
      stockBottom: -6,
    });
    const toolpath = runSteps(steps);
    const zs = feeds(toolpath).map(({ to }) => to[2]);
    expect(Math.min(...zs)).toBeCloseTo(-6);
    expect(Math.max(...zs)).toBeCloseTo(-4);
    expect(toolpath.warnings).toEqual([{ code: "toolpath.belowStock" }]);
  });

  it("spaces passes by the step-over and covers the outline", () => {
    const toolpath = finish(endMill, { stepOver: 50, strategy: parallel(0, "one_way") });
    const ys = [...new Set(feeds(toolpath).map(({ to }) => to[1].toFixed(6)))].map(Number);
    // On row centres from 0.05 to 9.95, no more than 3.175 mm apart: 5 passes.
    expect(ys.sort((a, b) => a - b)).toEqual([0.05, 2.55, 5.05, 7.45, 9.95]);
    // Each pass starts with the plunge, at the plunge rate.
    const xs = toolpath.moves.filter(({ kind }) => kind === "feed").map(({ to }) => to[0]);
    expect(Math.min(...xs)).toBeCloseTo(0.05);
    expect(Math.max(...xs)).toBeCloseTo(19.95);
  });

  it("alternates zig-zag passes, linked along the model", () => {
    const toolpath = finish(endMill, { strategy: parallel(0, "zigzag") });
    // One rapid down to the first pass, then it stays down.
    const plunges = toolpath.moves.filter(({ kind }) => kind === "rapid");
    expect(plunges.length).toBe(3);
    const firstPass = feeds(toolpath).filter(({ to }) => Math.abs(to[1] - 0.05) < 1e-9);
    expect(firstPass[0]?.to[0]).toBeLessThan(firstPass.at(-1)?.to[0] as number);
    const secondPass = feeds(toolpath).filter(({ to }) => Math.abs(to[1] - 2.55) < 1e-9);
    expect(secondPass[0]?.to[0]).toBeGreaterThan(secondPass.at(-1)?.to[0] as number);
  });

  it("retracts between one-way passes, all cut the same way", () => {
    const toolpath = finish(endMill, { strategy: parallel(0, "one_way") });
    const retracts = toolpath.moves.filter(({ kind, to }) => kind === "rapid" && to[2] === 5);
    expect(retracts.length).toBe(10);
    const secondPass = feeds(toolpath).filter(({ to }) => Math.abs(to[1] - 2.55) < 1e-9);
    expect(secondPass[0]?.to[0]).toBeLessThan(secondPass.at(-1)?.to[0] as number);
  });

  it("runs the passes at the angle", () => {
    const toolpath = finish(endMill, { strategy: parallel(90, "one_way") });
    const xs = [...new Set(feeds(toolpath).map(({ to }) => to[0].toFixed(6)))];
    // Along Y, 20 mm across at no more than 3.175 mm: 8 passes.
    expect(xs.length).toBe(8);
    for (const { to } of feeds(toolpath)) {
      if (to[0] < 10) expect(to[2]).toBeCloseTo(-4);
      if (to[0] > 10 + endMill.diameter / 2 + 0.1) expect(to[2]).toBeCloseTo(-10);
    }
  });

  it("starts and ends at the retract height", () => {
    const { moves } = finish(ballEndMill);
    expect(moves[0]).toMatchObject({
      kind: "rapid",
      to: [expect.any(Number), expect.any(Number), 5],
    });
    expect(moves.at(-1)).toMatchObject({
      kind: "rapid",
      to: [expect.any(Number), expect.any(Number), 5],
    });
  });

  it("warns when the model is cut at a coarser resolution", () => {
    const large = placed(1000, 1000, 10);
    const mesh = new Float32Array(rect(0, 0, 1000, 1000, 0));
    const steps = reliefFinishSteps(finishing(endMill, { stepOver: 100 }), large, mesh, options);
    const { warnings } = runSteps(steps);
    expect(warnings).toEqual([expect.objectContaining({ code: "toolpath.coarsened" })]);
  });

  it("reports progress up to 1 and reuses cached heightmaps", () => {
    const cache = createReliefCache();
    const steps = reliefFinishSteps(finishing(endMill, { stockToLeave: 0.5 }), STEP, stepMesh, {
      ...options,
      cache,
    });
    const progress: number[] = [];
    let result = steps.next();
    while (!result.done) {
      progress.push(result.value);
      result = steps.next();
    }
    expect(progress.every((value, i) => i === 0 || value >= (progress[i - 1] as number))).toBe(
      true,
    );
    expect(progress.at(-1)).toBe(1);
    // Cached, the same toolpath comes back from an empty mesh.
    const again = runSteps(
      reliefFinishSteps(finishing(endMill, { stockToLeave: 0.5 }), STEP, new Float32Array(), {
        ...options,
        cache,
      }),
    );
    expect(again).toEqual(result.value);
  });
});

describe("generateToolpath", () => {
  const input: ToolpathInput = {
    operation: finishing(endMill),
    shapes: [],
    model: STEP,
    stock: null,
    stockBottom: null,
    parting: null,
    flip: null,
    tabs: null,
    before: [],
    touchOff: null,
    pins: null,
    ...options,
  };

  it("computes 3D finishing from the model's mesh", () => {
    expect(generateToolpath(input, { mesh: () => stepMesh })).toEqual(finish(endMill));
  });

  it("needs the mesh", () => {
    expect(() => generateToolpath(input)).toThrow(MissingMeshError);
  });

  it("recomputes when the model is placed differently", () => {
    const moved = {
      ...STEP,
      placement: { ...STEP.placement, position: [1, 0] as [number, number] },
    };
    expect(toolpathKey({ ...input, model: moved })).not.toBe(toolpathKey(input));
    expect(toolpathKey({ ...input, model: { ...STEP, fileName: "renamed.stl" } })).toBe(
      toolpathKey(input),
    );
  });
});

describe("reachModel", () => {
  // 10 × 10 cells of 1 mm, the model over x ≥ 5 only.
  const grid = reliefGrid({ box: { min: [0, 0, -10], max: [10, 10, 0] } }, 0, 1) as ReliefGrid;
  const heights = new Float32Array(100).map((_, i) => (i % 10 >= 5 ? -2 : -Infinity));
  const tab = { modelId: "m", width: 2, top: -5 };

  it("carries a tab in from the outline to the model's surface, and no further", () => {
    expect(reachModel([{ ...tab, from: [0, 5.5], to: [-20, 5.5] }], grid, heights)).toEqual([
      { ...tab, from: [5, 5.5], to: [-20, 5.5] },
    ]);
  });

  it("leaves a tab already on the model, or whose way in misses it", () => {
    const on = { ...tab, from: [10, 5.5] as [number, number], to: [30, 5.5] as [number, number] };
    const away = { ...tab, from: [5, 0] as [number, number], to: [5, -20] as [number, number] };
    const empty = new Float32Array(100).fill(-Infinity);
    expect(reachModel([on], grid, heights)).toEqual([on]);
    expect(reachModel([away], grid, empty)).toEqual([away]);
  });
});
