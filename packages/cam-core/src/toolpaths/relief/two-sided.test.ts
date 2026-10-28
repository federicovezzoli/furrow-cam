import type { FlipAxis, Model, Operation, ProjectDocument, TwoSided } from "@furrow/document";
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
import { generateToolpath, toolpathCuts, toolpathInputs } from "../generate";
import type { Toolpath } from "../toolpath";
import { createCache } from "./finish";

/** A horizontal rectangle at height `z`, as two triangles. */
function rect(x0: number, y0: number, x1: number, y1: number, z: number): number[] {
  return [x0, y0, z, x1, y0, z, x1, y1, z, x0, y0, z, x1, y1, z, x0, y1, z];
}

/**
 * A 20 × 10 block through the 18 mm stock: full height over y < 5, 4 mm
 * thinner on each face over y > 5. The same from either face, so the
 * bottom side sees the top side's view mirrored.
 */
const BLOCK: Model = {
  ...modelFixture,
  bounds: { min: [0, 0, 0], max: [20, 10, 18] },
  placement: { rotation: [0, 0, 0], scale: 1, depth: 18, position: [20, 20] },
};
const blockMesh = new Float32Array([
  ...rect(0, 0, 20, 5, 18),
  ...rect(0, 5, 20, 10, 14),
  ...rect(0, 0, 20, 5, 0),
  ...rect(0, 5, 20, 10, 4),
]);

const STOCK = { width: 60, height: 50, thickness: 18 };

let next = 0;
function id() {
  next++;
  return `00000000-0000-4000-8000-${next.toString().padStart(12, "0")}`;
}

/** 3D roughing up to the stock's edges, so it clears down to the floor around the model. */
function roughing(stockSide: Operation["stockSide"], rest = false): Operation {
  const boundary = { type: "stock" } as const;
  const params = { ...reliefRough.params, modelId: BLOCK.id, stockToLeave: 0, boundary, rest };
  return { ...reliefRough, id: id(), stockSide, tool: endMill, params };
}

function finishing(stockSide: Operation["stockSide"], rest = false): Operation {
  const params = { ...reliefFinish.params, modelId: BLOCK.id, stockToLeave: 0, rest };
  return { ...reliefFinish, id: id(), stockSide, tool: ballEndMill, params };
}

function project(operations: Operation[], twoSided: TwoSided): ProjectDocument {
  const doc = fullDocument();
  return {
    ...doc,
    stock: {
      ...STOCK,
      xyOrigin: { anchor: "bottom_left" },
      zOrigin: "stock_top",
      touchOff: null,
      twoSided,
    },
    models: [BLOCK],
    operations,
  };
}

function toolpaths(doc: ProjectDocument, mesh = blockMesh): Toolpath[] {
  const context = { mesh: () => mesh, cuts: createCache<never>(8) };
  return toolpathInputs(doc).map((input) => generateToolpath(input, context));
}

/** The stock one operation leaves, on 0.25 mm cells, as `(column, row) => height`. */
function simulate(operation: Operation, toolpath: Toolpath) {
  const grid = { columns: 240, rows: 200, cellWidth: 0.25, cellHeight: 0.25 };
  const { heights } = simulateCuts(STOCK, toolpathCuts(operation, toolpath), grid);
  return (column: number, row: number) => heights[row * grid.columns + column] as number;
}

const lowest = (toolpath: Toolpath) => Math.min(...toolpath.moves.map(({ to }) => to[2]));

describe("relief toolpaths on two sides", () => {
  it.each<[string, typeof roughing, FlipAxis, number, number]>([
    ["rough", roughing, "x", 1, -1],
    ["rough", roughing, "y", -1, 1],
    ["finish", finishing, "x", 1, -1],
    ["finish", finishing, "y", -1, 1],
  ])("%s a symmetric model the same from below, mirrored, about %s", (_, cut, flipAxis, sx, sy) => {
    const operations = [cut("top"), cut("bottom")];
    const [top, bottom] = toolpaths(
      project(operations, { flipAxis, partingDepth: 9, tabs: null, lineUp: null }),
    );
    const above = simulate(operations[0] as Operation, top as Toolpath);
    const below = simulate(operations[1] as Operation, bottom as Toolpath);
    const column = (c: number) => (sx > 0 ? c : 239 - c);
    const row = (r: number) => (sy > 0 ? r : 199 - r);
    let differing = 0;
    for (let r = 0; r < 200; r++) {
      for (let c = 0; c < 240; c++) {
        if (Math.abs(above(c, r) - below(column(c), row(r))) > 0.05) differing++;
      }
    }
    // Only cells along the tool's path edges may round differently.
    expect(differing / (240 * 200)).toBeLessThan(0.002);
    // The thinner half is cut into on either face, the full-height half isn't.
    expect(above(120, 108)).toBeLessThan(-3);
    expect(above(120, 88)).toBe(0);
  });

  it("cuts each side down to the parting plane around the model and no further", () => {
    const operations = [roughing("top"), finishing("top"), roughing("bottom"), finishing("bottom")];
    const [roughTop, finishTop, roughBottom, finishBottom] = toolpaths(
      project(operations, { flipAxis: "x", partingDepth: 6, tabs: null, lineUp: null }),
    ) as Toolpath[];
    // 6 mm below the top, 12 mm below the bottom face.
    for (const toolpath of [roughTop, finishTop]) {
      expect(lowest(toolpath as Toolpath)).toBeGreaterThanOrEqual(-6 - 1e-9);
    }
    for (const toolpath of [roughBottom, finishBottom]) {
      expect(lowest(toolpath as Toolpath)).toBeGreaterThanOrEqual(-12 - 1e-9);
    }
    expect(lowest(roughTop as Toolpath)).toBeCloseTo(-6);
    expect(lowest(roughBottom as Toolpath)).toBeCloseTo(-12);
    // The stock reaching past the model's depth isn't a warning on either side.
    for (const toolpath of [roughTop, roughBottom]) {
      expect(toolpath?.warnings).not.toContainEqual({ code: "toolpath.belowStock" });
    }
  });

  it("cuts down to the parting plane around a model that doesn't reach it", () => {
    // 6 mm deep, so 3 mm of stock below it lies above the parting plane.
    const shallow = { ...BLOCK, placement: { ...BLOCK.placement, depth: 6 } };
    const doc = {
      ...project([roughing("top")], { flipAxis: "x", partingDepth: 9, tabs: null, lineUp: null }),
      models: [shallow],
    };
    const [top] = toolpaths(doc) as Toolpath[];
    expect(lowest(top as Toolpath)).toBeCloseTo(-9);
  });

  it("cuts all of the model a side sees, past the parting plane", () => {
    // A cup: a pit 7 mm across, 16 mm deep, in a rim.
    const cup = new Float32Array([
      ...rect(0, 0, 20, 1.5, 18),
      ...rect(0, 8.5, 20, 10, 18),
      ...rect(0, 1.5, 4, 8.5, 18),
      ...rect(16, 1.5, 20, 8.5, 18),
      ...rect(4, 1.5, 16, 8.5, 2),
      ...rect(0, 0, 20, 10, 0),
    ]);
    const operations = [roughing("top"), finishing("top")];
    const [rough, finish] = toolpaths(
      project(operations, { flipAxis: "x", partingDepth: 9, tabs: null, lineUp: null }),
      cup,
    ) as Toolpath[];
    // Cells of 0.25 mm: the stock beside the model, then the pit's middle.
    expect(simulate(operations[0] as Operation, rough as Toolpath)(20, 20)).toBeCloseTo(-9, 1);
    expect(lowest(finish as Toolpath)).toBeCloseTo(-16);
    expect(simulate(operations[1] as Operation, finish as Toolpath)(120, 100)).toBeCloseTo(-16, 1);
  });

  it("cuts under a model's widest part from the side below, leaving no skirt", () => {
    // A mushroom: a cap 8 mm thick over a stem over y < 5, seen from below.
    const mushroom = new Float32Array([
      ...rect(0, 0, 20, 10, 18),
      ...rect(0, 5, 20, 10, 10),
      ...rect(0, 0, 20, 5, 0),
    ]);
    const operations = [roughing("bottom"), finishing("bottom")];
    const [rough, finish] = toolpaths(
      project(operations, { flipAxis: "x", partingDepth: 9, tabs: null, lineUp: null }),
      mushroom,
    ) as Toolpath[];
    expect(simulate(operations[0] as Operation, rough as Toolpath)(20, 20)).toBeCloseTo(-9, 1);
    // The cap's underside is 10 mm up from the bottom face, the plane 9 mm.
    expect(lowest(finish as Toolpath)).toBeCloseTo(-10);
    // Turned over about X, the overhang is at y 20–25 of the bottom side, out to its edge.
    const below = simulate(operations[1] as Operation, finish as Toolpath);
    expect(below(120, 90)).toBeCloseTo(-10, 1);
    expect(below(120, 81)).toBeCloseTo(-10, 1);
  });

  it.each<[FlipAxis, (x: number, y: number) => [number, number]]>([
    ["x", (x, y) => [x, 50 - y]],
    ["y", (x, y) => [60 - x, y]],
  ])("leaves the holding tabs on the bottom side, turned over about %s", (flipAxis, flip) => {
    // A tab 6 mm wide and 2 mm thick, below the model, from x 27 to 33.
    const tabs = { width: 6, thickness: 2, positions: [[30, 12] as [number, number]] };
    const operations = [roughing("top"), roughing("bottom"), finishing("bottom")];
    const doc = project(operations, { flipAxis, partingDepth: 9, tabs, lineUp: null });
    const [top, rough, finish] = toolpaths(doc) as Toolpath[];
    const inputs = toolpathInputs(doc);
    expect(inputs[0]?.tabs).toBeNull();
    const [from, to] = [flip(30, 25), flip(30, 0)];
    expect(inputs[1]?.tabs).toEqual([{ from, to, width: 6, top: -7 }]);
    expect(lowest(top as Toolpath)).toBeLessThan(-7);
    for (const [index, toolpath] of [rough, finish].entries()) {
      const below = simulate(operations[index + 1] as Operation, toolpath as Toolpath);
      /** The bottom side's simulated height at the top side's `(x, y)`. */
      const at = (x: number, y: number) => {
        const [bx, by] = flip(x, y);
        return below(Math.floor(bx * 4), Math.floor(by * 4));
      };
      for (const [x, y] of [
        [27.2, 3],
        [30, 10],
        [32.8, 18],
      ]) {
        expect(at(x as number, y as number)).toBeGreaterThanOrEqual(-7 - 1e-6);
      }
      // Beside it, the bottom side's roughing cuts up to the parting plane.
      if (index === 0) expect(at(45, 10)).toBeCloseTo(-9, 1);
    }
    for (const toolpath of [rough, finish]) {
      expect(toolpath?.warnings).not.toContainEqual({ code: "toolpath.noHoldingTabs" });
    }
  });

  it("warns when the bottom side frees the part without tabs, or roughs the whole stock", () => {
    const operations = [roughing("top"), roughing("bottom"), finishing("bottom")];
    const [top, rough, finish] = toolpaths(
      project(operations, { flipAxis: "x", partingDepth: 9, tabs: null, lineUp: null }),
    ) as Toolpath[];
    expect(top?.warnings).not.toContainEqual({ code: "toolpath.noHoldingTabs" });
    expect(rough?.warnings).toContainEqual({ code: "toolpath.noHoldingTabs" });
    expect(finish?.warnings).toContainEqual({ code: "toolpath.noHoldingTabs" });
    for (const toolpath of [top, rough]) {
      expect(toolpath?.warnings).toContainEqual({ code: "toolpath.stockBoundaryTwoSided" });
    }
  });

  it("rest machines the bottom side from what the bottom side's earlier operations left", () => {
    // A 2D operation on the bottom side counts too: it is flipped like the rest.
    const [profile] = fullDocument().operations;
    const operations = [
      roughing("top"),
      roughing("bottom"),
      { ...(profile as Operation), stockSide: "bottom" as const },
      finishing("top"),
      finishing("bottom", true),
    ];
    const doc = {
      ...project(operations, { flipAxis: "y", partingDepth: 9, tabs: null, lineUp: null }),
    };
    const inputs = toolpathInputs({ ...doc, geometry: fullDocument().geometry });
    expect(inputs[4]?.before.map((input) => input.operation)).toEqual([
      operations[1],
      operations[2],
    ]);
  });

  it("machines one-sided projects as before", () => {
    const doc = {
      ...project([roughing("top")], { flipAxis: "x", partingDepth: 9, tabs: null, lineUp: null }),
    };
    const [oneSided] = toolpathInputs({ ...doc, stock: { ...doc.stock, twoSided: null } });
    expect(oneSided).toMatchObject({ parting: null, flip: null, tabs: null, stockBottom: -18 });
  });
});
