import type { Model, Point, ReliefRoughOperation, Tool } from "@furrow/document";
import {
  ballEndMill,
  endMill,
  fullDocument,
  model as modelFixture,
  reliefRough,
} from "@furrow/document/fixtures";
import { describe, expect, it } from "vitest";
import { containment, difference, offset, type Polygon, signedArea } from "../../geometry/clipper";
import { simulateCuts } from "../../simulation/simulation";
import { generateToolpath, toolpathInputs, toolpathKey } from "../generate";
import type { Toolpath } from "../toolpath";
import { heightContours, simplifyContour } from "./contours";
import { modelHeightsSteps, reliefGrid, runSteps } from "./finish";
import { type ReliefRoughOptions, reliefRoughSteps, roughingArea } from "./rough";

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
  // A point of the box at the stock top, so the bounds are what the mesh holds.
  ...rect(19.99, 9.99, 20, 10, 0),
]);

function roughing(
  tool: Tool,
  params: Partial<ReliefRoughOperation["params"]> = {},
): ReliefRoughOperation {
  return { ...reliefRough, tool, params: { ...reliefRough.params, modelId: STEP.id, ...params } };
}

const options: ReliefRoughOptions = { safeZ: 5, entryClearance: 1, stock: null };

function rough(
  tool: Tool,
  params: Partial<ReliefRoughOperation["params"]> = {},
  roughOptions: Partial<ReliefRoughOptions> = {},
): Toolpath {
  return runSteps(
    reliefRoughSteps(roughing(tool, params), STEP, stepMesh, { ...options, ...roughOptions }),
  );
}

const feedPoints = ({ moves }: Toolpath) =>
  moves.filter(({ kind }) => kind === "feed").map(({ to }) => to);

/** The stock after `toolpath`, rapids included, on a grid of 0.1 mm cells over `width` × `length`. */
function simulate(toolpath: Toolpath, tool: Tool, width = 20, length = 10) {
  const { moves } = toolpath;
  const segments: number[] = [];
  for (let i = 1; i < moves.length; i++) {
    segments.push(...(moves[i - 1]?.to ?? []), ...(moves[i]?.to ?? []));
  }
  const columns = Math.round(width / 0.1);
  const rows = Math.round(length / 0.1);
  const stock = simulateCuts(
    { width, height: length, thickness: 20 },
    [{ tool, segments: new Float32Array(segments) }],
    { columns, rows, cellWidth: 0.1, cellHeight: 0.1 },
  );
  return {
    ...stock,
    at: ([x, y]: Point) =>
      stock.heights[Math.floor(y / 0.1) * columns + Math.floor(x / 0.1)] as number,
  };
}

/** Whether `point` is inside `rings` with the non-zero rule. */
function inside(rings: Polygon[], point: Point): boolean {
  let winding = 0;
  for (const ring of rings) {
    if (containment(point, ring) === "inside") winding += Math.sign(signedArea(ring));
  }
  return winding !== 0;
}

describe("roughingArea", () => {
  // A 20 × 10 model at (10, 10) on a 50 × 40 stock, cut with a 3 mm radius.
  const model: Model = { ...STEP, placement: { ...STEP.placement, position: [10, 10] } };
  const stock = { min: [0, 0] as Point, max: [50, 40] as Point };

  it("is the model's outline, or the whole stock", () => {
    expect(roughingArea({ type: "model" }, model, stock, 3)).toEqual({
      min: [10, 10],
      max: [30, 20],
    });
    expect(roughingArea({ type: "stock" }, model, stock, 3)).toEqual(stock);
    expect(roughingArea({ type: "stock" }, model, null, 3)).toEqual({
      min: [10, 10],
      max: [30, 20],
    });
  });

  it("keeps the tool inside the margin", () => {
    expect(roughingArea({ type: "margin", distance: 5 }, model, stock, 3)).toEqual({
      min: [8, 8],
      max: [32, 22],
    });
  });

  it("grows by the radius at least, so the tool's centre reaches the model's edges", () => {
    expect(roughingArea({ type: "margin", distance: 1 }, model, stock, 3)).toEqual({
      min: [10, 10],
      max: [30, 20],
    });
  });

  it("is null when the margin leaves the tool no room on the stock", () => {
    // The model 200 mm off a 100 mm wide stock.
    const off: Model = { ...STEP, placement: { ...STEP.placement, position: [200, 10] } };
    const narrow = { min: [0, 0] as Point, max: [100, 40] as Point };
    expect(roughingArea({ type: "margin", distance: 10 }, off, narrow, 3)).toBeNull();
    // Just off the stock: the margin reaches 2 mm onto it, less than the tool.
    const edge: Model = { ...STEP, placement: { ...STEP.placement, position: [108, 10] } };
    expect(roughingArea({ type: "margin", distance: 10 }, edge, narrow, 3)).toBeNull();
    const toolpath = runSteps(
      reliefRoughSteps(
        roughing(endMill, { boundary: { type: "margin", distance: 10 } }),
        off,
        stepMesh,
        { ...options, stock: narrow },
      ),
    );
    expect(toolpath.moves).toEqual([]);
    expect(toolpath.warnings).toEqual([{ code: "toolpath.roughMarginOffStock" }]);
  });

  it("brings the tool's centre to the stock's edges the margin reaches", () => {
    // Left and bottom reach the stock's edges; right and top stay inside.
    expect(roughingArea({ type: "margin", distance: 12 }, model, stock, 3)).toEqual({
      min: [0, 0],
      max: [39, 29],
    });
    expect(roughingArea({ type: "margin", distance: 12 }, model, null, 3)).toEqual({
      min: [1, 1],
      max: [39, 29],
    });
  });
});

describe("heightContours", () => {
  const grid = { columns: 4, rows: 3, cellWidth: 1, cellHeight: 1 };

  it("outlines a cell above the level as a counter-clockwise square", () => {
    const heights = [0, 0, 0, 0, 0, 5, 0, 0, 0, 0, 0, 0];
    expect(heightContours(heights, grid, 1)).toEqual([
      [
        [2, 1],
        [2, 2],
        [1, 2],
        [1, 1],
      ],
    ]);
  });

  it("merges straight runs, in cell units and moved by the origin", () => {
    const heights = [5, 5, 5, 0, 5, 0, 0, 0, 0, 0, 0, 0];
    const rings = heightContours(heights, { ...grid, cellWidth: 2, cellHeight: 0.5 }, 1, [10, 20]);
    expect(rings).toEqual([
      [
        [16, 20],
        [16, 20.5],
        [12, 20.5],
        [12, 21],
        [10, 21],
        [10, 20],
      ],
    ]);
    expect(signedArea(rings[0] as Polygon)).toBeGreaterThan(0);
  });

  it("winds enclosed low cells clockwise", () => {
    const heights = [5, 5, 5, 0, 5, 0, 5, 0, 5, 5, 5, 0];
    const rings = heightContours(heights, grid, 1);
    expect(rings.map((ring) => Math.sign(signedArea(ring)))).toEqual([1, -1]);
    expect(rings[1]?.length).toBe(4);
  });

  it("keeps cells that touch at a corner apart", () => {
    const heights = [5, 0, 0, 0, 0, 5, 0, 0, 0, 0, 0, 0];
    const rings = heightContours(heights, grid, 1);
    expect(rings.length).toBe(2);
    expect(rings.every((ring) => ring.length === 4)).toBe(true);
  });

  it("leaves out cells at the level, rounded to float32", () => {
    const heights = new Float32Array([-9.7, -9.7, -9.7, -9.7]);
    expect(heightContours(heights, { ...grid, columns: 2, rows: 2 }, -9.7)).toEqual([]);
  });

  it("holds every cell above the level and none of the others", () => {
    const big = { columns: 30, rows: 20, cellWidth: 0.5, cellHeight: 0.25 };
    // Deterministic noise with pits, peaks and diagonal contacts.
    const heights = Array.from({ length: 600 }, (_, i) => Math.sin(i * 12.9898) * 10);
    const rings = heightContours(heights, big, 2, [1, 2]);
    for (let row = 0; row < big.rows; row++) {
      for (let column = 0; column < big.columns; column++) {
        const centre: Point = [1 + (column + 0.5) * 0.5, 2 + (row + 0.5) * 0.25];
        const above = (heights[row * big.columns + column] as number) > 2;
        expect(inside(rings, centre)).toBe(above);
      }
    }
  });
});

describe("simplifyContour", () => {
  it("keeps every point within the tolerance; grown by twice it, it covers the ring", () => {
    // A staircase circle along cells of 0.1 mm.
    const grid = { columns: 100, rows: 100, cellWidth: 0.1, cellHeight: 0.1 };
    const heights = Array.from({ length: 10_000 }, (_, i) =>
      Math.hypot((i % 100) - 49.5, Math.floor(i / 100) - 49.5) < 40 ? 1 : 0,
    );
    const [ring] = heightContours(heights, grid, 0.5);
    if (!ring) throw new Error("no contour");
    const simple = simplifyContour(ring, 0.1);
    expect(simple.length).toBeLessThan(ring.length / 3);
    const closed = [...simple, simple[0] as Point];
    for (const point of ring) {
      let nearest = Infinity;
      for (let i = 1; i < closed.length; i++) {
        const a = closed[i - 1] as Point;
        const b = closed[i] as Point;
        const t = Math.max(
          0,
          Math.min(
            1,
            ((point[0] - a[0]) * (b[0] - a[0]) + (point[1] - a[1]) * (b[1] - a[1])) /
              ((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2),
          ),
        );
        nearest = Math.min(
          nearest,
          Math.hypot(a[0] + t * (b[0] - a[0]) - point[0], a[1] + t * (b[1] - a[1]) - point[1]),
        );
      }
      expect(nearest).toBeLessThanOrEqual(0.1 + 1e-9);
    }
    expect(difference([ring], offset([simple], 0.2, { join: "miter" }))).toEqual([]);
  });

  it("keeps rings no wider than the tolerance, which would enclose nothing", () => {
    const grid = { columns: 5, rows: 5, cellWidth: 1, cellHeight: 1 };
    const cell = Array.from({ length: 25 }, (_, i) => (i === 12 ? 5 : 0));
    const strip = Array.from({ length: 25 }, (_, i) => (i >= 10 && i < 15 ? 5 : 0));
    for (const heights of [cell, strip]) {
      const [ring] = heightContours(heights, grid, 1);
      if (!ring) throw new Error("no contour");
      const simple = simplifyContour(ring, 1);
      expect(simple).toEqual(ring);
      expect(difference([ring], offset([simple], 2, { join: "miter" }))).toEqual([]);
    }
  });

  it("leaves a square alone", () => {
    const square: Polygon = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ];
    expect(simplifyContour(square, 0.1)).toEqual(square);
  });
});

describe("reliefRoughSteps", () => {
  it("clears in levels down to the model's bottom plus the stock to leave", () => {
    const toolpath = rough(endMill, { stockToLeave: 0.5 });
    expect(toolpath.warnings).toEqual([]);
    const zs = new Set(feedPoints(toolpath).map(([, , z]) => z.toFixed(6)));
    // 9.5 mm in steps no deeper than the tool's 2 mm.
    for (const level of [-1.9, -3.8, -5.7, -7.6, -9.5]) expect(zs).toContain(level.toFixed(6));
    expect(Math.min(...feedPoints(toolpath).map(([, , z]) => z))).toBeCloseTo(-9.5);
  });

  for (const [label, tool, params] of [
    ["offset clearing", endMill, { strategy: { type: "offset" } }],
    ["linear clearing", endMill, { strategy: { type: "linear", angle: 45 }, ramp: false }],
    ["linear clearing, ramping in", endMill, { strategy: { type: "linear", angle: 0 } }],
    ["peeling", endMill, { strategy: { type: "peel", start: "centre" } }],
    ["a ball end mill", ballEndMill, { stockToLeave: 0.2, direction: "conventional" }],
  ] as const) {
    it(`never cuts below the offset model, with ${label}`, () => {
      const stockToLeave = "stockToLeave" in params ? params.stockToLeave : 0.5;
      const toolpath = rough(tool, { stockToLeave, ...params });
      const stock = simulate(toolpath, tool);
      const grid = reliefGrid(STEP, 0, 0.1, undefined, stockToLeave + 0.1);
      if (!grid) throw new Error("no grid");
      const model = runSteps(modelHeightsSteps(STEP, stepMesh, grid, stockToLeave, undefined));
      for (let row = 0; row < stock.rows; row++) {
        for (let column = 0; column < stock.columns; column++) {
          const x = (column + 0.5) * 0.1 - grid.origin[0];
          const y = (row + 0.5) * 0.1 - grid.origin[1];
          const cell =
            Math.floor(y / grid.cellHeight) * grid.columns + Math.floor(x / grid.cellWidth);
          expect(stock.heights[row * stock.columns + column]).toBeGreaterThanOrEqual(
            (model[cell] as number) - 1e-4,
          );
        }
      }
    });
  }

  it("leaves a fin one cell wide standing", () => {
    // A 0.1 mm fin up to -2 across the floor, one cell of the 0.1 mm grid.
    const mesh = new Float32Array([...stepMesh, ...rect(14.95, 0, 15.05, 10, -2)]);
    for (const strategy of [{ type: "offset" }, { type: "peel", start: "centre" }] as const) {
      const operation = roughing(endMill, { strategy, stockToLeave: 0 });
      const toolpath = runSteps(reliefRoughSteps(operation, STEP, mesh, options));
      const stock = simulate(toolpath, endMill);
      expect(stock.at([15, 5])).toBeGreaterThanOrEqual(-2 - 1e-4);
    }
  });

  it("keeps the stock to leave on vertical walls, and little more", () => {
    const toolpath = rough(endMill, { stockToLeave: 0.5 });
    const stock = simulate(toolpath, endMill);
    // The wall at x = 10 stands to the plateau's offset top within the stock to leave.
    expect(stock.at([10.35, 5])).toBeGreaterThanOrEqual(-4 + Math.sqrt(0.25 - 0.35 ** 2) - 1e-4);
    expect(stock.at([10.05, 5])).toBeGreaterThanOrEqual(-3.5 - 1e-4);
    // Half a millimetre further out, the floor is cleared to its offset.
    expect(stock.at([11, 5])).toBeCloseTo(-9.5);
    // The plateau's offset top, -3.5, is between two levels: the one above is as low as it goes.
    expect(stock.at([5, 5])).toBeCloseTo(-1.9);
  });

  it("clears linearly with straight passes that rise over the model", () => {
    const linear = { type: "linear", angle: 0 } as const;
    const toolpath = rough(endMill, { strategy: linear, ramp: false, stepOver: 20 });
    const spacing = (endMill.diameter * 20) / 100;
    // Every move starts and ends on a pass: none follows the model's edges.
    const ys = new Set(feedPoints(toolpath).map(([, y]) => y.toFixed(6)));
    const rows = [...ys].map(Number).sort((a, b) => a - b);
    expect(rows.length).toBeLessThan(12);
    for (let i = 1; i < rows.length; i++) {
      expect((rows[i] as number) - (rows[i - 1] as number)).toBeLessThanOrEqual(spacing);
    }
    // Over the plateau, the level at -3.8 rides on its offset top, -3.5.
    expect(feedPoints(toolpath).some(([x, , z]) => x < 9 && Math.abs(z + 3.5) < 1e-3)).toBe(true);
    // Passes reach the outline's far edges, within a cell.
    const all = feedPoints(toolpath).map(([, y]) => y);
    expect(Math.min(...all)).toBeLessThan(0.1);
    expect(Math.max(...all)).toBeGreaterThan(9.9);
  });

  describe("with a margin", () => {
    // The step model 15 mm in from the stock's left and bottom edges.
    const inset: Model = { ...STEP, placement: { ...STEP.placement, position: [15, 15] } };
    const stock = { min: [0, 0] as Point, max: [60, 50] as Point };
    const boundary = { type: "margin", distance: 10 } as const;

    const strategies = [
      { type: "offset" },
      { type: "peel", start: "centre" },
      { type: "peel", start: "outside" },
      { type: "linear", angle: 0 },
    ] as const;
    for (const strategy of strategies) {
      const label = strategy.type === "peel" ? `peel from the ${strategy.start}` : strategy.type;
      it(`clears the model's outline grown by the margin and no further, with ${label}`, () => {
        const toolpath = runSteps(
          reliefRoughSteps(roughing(endMill, { strategy, boundary }), inset, stepMesh, {
            ...options,
            stock,
          }),
        );
        const { at } = simulate(toolpath, endMill, 60, 50);
        // The margin runs from (5, 5) to (45, 35); the stock top beyond it is left alone.
        for (const point of [
          [4.8, 20],
          [45.2, 20],
          [25, 4.8],
          [25, 35.2],
          [2, 2],
          [55, 45],
        ] as Point[]) {
          expect(at(point)).toBe(0);
        }
        // Inside it, everything around the model goes down to its bottom plus the stock to leave.
        for (const point of [
          [5.5, 20],
          [44.5, 20],
          [25, 5.5],
          [25, 34.5],
          [32, 20],
        ] as Point[]) {
          expect(at(point)).toBeCloseTo(-9.5);
        }
      });
    }
  });

  it("trims passes to where the level above left material", () => {
    const toolpath = rough(endMill, { strategy: { type: "linear", angle: 0 }, ramp: false });
    // Below the plateau's offset top, levels only cut beside it.
    for (const [x, , z] of feedPoints(toolpath)) {
      if (z < -4) expect(x).toBeGreaterThan(10);
    }
  });

  it("brings the tool's centre to the model's outline, or to the stock's", () => {
    const xs = (toolpath: Toolpath) => feedPoints(toolpath).map(([x]) => x);
    // Passes sample cell centres, so they stop within a cell of the edges.
    const model = rough(endMill, { strategy: { type: "linear", angle: 0 } });
    expect(Math.min(...xs(model))).toBeGreaterThanOrEqual(0);
    expect(Math.min(...xs(model))).toBeLessThan(0.1);
    expect(Math.max(...xs(model))).toBeLessThanOrEqual(20);
    expect(Math.max(...xs(model))).toBeGreaterThan(19.9);

    const stock = { min: [0, 0] as Point, max: [40, 30] as Point };
    const whole = rough(
      endMill,
      { strategy: { type: "linear", angle: 0 }, boundary: { type: "stock" } },
      { stock },
    );
    expect(Math.max(...xs(whole))).toBeGreaterThan(39.9);
    const at = simulate(whole, endMill, 40, 30).at;
    expect(at([30, 20])).toBeCloseTo(-9.5);
  });

  it("spaces the passes by its step-over", () => {
    const passes = (toolpath: Toolpath) =>
      new Set(
        feedPoints(toolpath)
          .filter(([, , z]) => Math.abs(z + 9.5) < 1e-9)
          .map(([, y]) => y.toFixed(6)),
      ).size;
    const linear = { strategy: { type: "linear", angle: 0 } } as const;
    const wide = rough(endMill, { ...linear, stepOver: 40 });
    expect(passes(rough(endMill, { ...linear, stepOver: 10 }))).toBeGreaterThan(passes(wide));
  });

  it("starts and ends at the retract height", () => {
    const { moves } = rough(endMill);
    expect(moves[0]).toMatchObject({
      kind: "rapid",
      to: [expect.any(Number), expect.any(Number), 5],
    });
    expect(moves.at(-1)).toMatchObject({
      kind: "rapid",
      to: [expect.any(Number), expect.any(Number), 5],
    });
  });

  it("cuts no deeper than the stock's bottom, and says so", () => {
    const toolpath = rough(endMill, { stockToLeave: 0.5 }, { stockBottom: -6 });
    expect(Math.min(...feedPoints(toolpath).map(([, , z]) => z))).toBeCloseTo(-6);
    expect(toolpath.warnings).toEqual([{ code: "toolpath.belowStock" }]);
    // A stock deep enough changes nothing.
    expect(rough(endMill, {}, { stockBottom: -20 })).toEqual(rough(endMill));
  });

  it("has nothing to rough when the stock to leave covers the model", () => {
    expect(rough(endMill, { stockToLeave: 10 })).toEqual({
      moves: [],
      warnings: [{ code: "toolpath.roughNothing" }],
    });
  });

  it("warns when the model is deeper than the tool's flutes", () => {
    expect(rough({ ...endMill, fluteLength: 5 }).warnings).toEqual([
      { code: "toolpath.depthExceedsFlutes" },
    ]);
  });

  it("reports progress up to 1", () => {
    const steps = reliefRoughSteps(roughing(endMill), STEP, stepMesh, options);
    const progress: number[] = [];
    for (let step = steps.next(); !step.done; step = steps.next()) progress.push(step.value);
    expect(progress.every((value, i) => i === 0 || value >= (progress[i - 1] as number))).toBe(
      true,
    );
    expect(progress.at(-1)).toBe(1);
  });
});

describe("generateToolpath", () => {
  const document = () => ({ ...fullDocument(), models: [STEP], operations: [roughing(endMill)] });

  it("computes 3D roughing from the model's mesh", () => {
    const [input] = toolpathInputs(document());
    if (!input) throw new Error("no input");
    expect(generateToolpath(input, { mesh: () => stepMesh })).toEqual(rough(endMill));
  });

  it("stops at the stock's bottom", () => {
    const doc = document();
    const [input] = toolpathInputs({ ...doc, stock: { ...doc.stock, thickness: 6 } });
    expect(input?.stockBottom).toBe(-6);
    expect(toolpathInputs(fullDocument())[0]?.stockBottom).toBeNull();
  });

  it("depends on the stock's size only for the stock and margin boundaries", () => {
    const doc = document();
    const resized = { ...doc, stock: { ...doc.stock, width: 500 } };
    expect(doc.stock.thickness).toBeGreaterThan(10);
    const key = (d: typeof doc) => toolpathKey(toolpathInputs(d)[0] as never);
    expect(key(resized)).toBe(key(doc));
    for (const boundary of [{ type: "stock" }, { type: "margin", distance: 5 }] as const) {
      const operations = [roughing(endMill, { boundary })];
      expect(key({ ...resized, operations })).not.toBe(key({ ...doc, operations }));
    }
  });
});
