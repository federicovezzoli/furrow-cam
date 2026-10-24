import {
  createProjectDocument,
  type Operation,
  type Path,
  type Point,
  type ProjectDocument,
  type Shape,
} from "@furrow/document";
import {
  DRAWING_ID,
  drill,
  endMill,
  lowRider,
  model,
  reliefFinish,
  reliefRough,
  machine as shapeoko,
  vBit,
} from "@furrow/document/fixtures";
import { describe, expect, it } from "vitest";
import { exportGcode } from "./export";
import { GcodeExportError } from "./post";

function rectangle([x, y]: Point, width: number, height: number): Path {
  return {
    start: [x, y],
    segments: [
      { kind: "line", to: [x + width, y] },
      { kind: "line", to: [x + width, y + height] },
      { kind: "line", to: [x, y + height] },
    ],
    closed: true,
  };
}

function circle(center: Point, radius: number): Path {
  const start: Point = [center[0] + radius, center[1]];
  return { start, segments: [{ kind: "arc", to: start, center, clockwise: false }], closed: true };
}

function shape(n: number, name: string, ...paths: Path[]): Shape {
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    name,
    layer: "0",
    drawingId: DRAWING_ID,
    paths,
  };
}

function id(n: number): string {
  return `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

const plate = shape(1, "Plate", rectangle([20, 20], 120, 80));
const holes = shape(2, "Holes", circle([40, 40], 3), circle([120, 40], 3), circle([80, 80], 3));
const recess = shape(3, "Recess", rectangle([60, 50], 40, 20));

/** A plate with a recess and three holes, cut out with tabs. */
function referenceProject(): ProjectDocument {
  const profile: Operation = {
    id: id(1),
    type: "profile",
    name: "Cut out",
    enabled: true,
    stockSide: "top",
    targets: [{ shapeId: plate.id, paths: null }],
    tool: endMill,
    params: {
      side: "outside",
      direction: "climb",
      depth: 6,
      allowance: 0,
      finishPass: false,
      leadIn: null,
      ramp: false,
      tabs: { width: 6, height: 2, positions: [[80, 20]] },
    },
  };
  return {
    ...createProjectDocument(),
    stock: {
      width: 160,
      height: 120,
      thickness: 6,
      xyOrigin: { anchor: "bottom_left" },
      zOrigin: "stock_top",
      touchOff: null,
      twoSided: null,
    },
    machine: shapeoko,
    geometry: [plate, holes, recess],
    models: [],
    operations: [
      {
        id: id(2),
        type: "drill",
        name: "Holes",
        enabled: true,
        stockSide: "top",
        targets: [{ shapeId: holes.id, paths: null }],
        tool: drill,
        params: { depth: 6, peck: true, stepOver: 40 },
      },
      {
        id: id(3),
        type: "pocket",
        name: "Recess",
        enabled: true,
        stockSide: "top",
        targets: [{ shapeId: recess.id, paths: null }],
        tool: endMill,
        params: {
          strategy: { type: "offset" },
          direction: "climb",
          stepOver: 40,
          depth: 3,
          allowance: 0,
          finishPass: false,
          ramp: true,
        },
      },
      profile,
      { ...profile, id: id(4), name: "Disabled", enabled: false },
    ],
  };
}

describe("exportGcode", () => {
  // Whole programs are checked in by the corpus (e2e/corpus.test.ts).
  it("posts the enabled operations, in a file named after the project", () => {
    const { gcode, warnings, fileName } = exportGcode(referenceProject(), "Plate");
    expect(fileName).toBe("Plate.gcode");
    expect(warnings).toEqual([]);
    expect(gcode).toContain("(Operation: Cut out)");
    expect(gcode).not.toContain("Disabled");
  });

  it("writes no spindle speeds for a manual spindle", () => {
    const doc = referenceProject();
    doc.machine = lowRider;
    const { gcode } = exportGcode(doc, "Plate");
    expect(gcode).toContain("M3\n");
    expect(gcode).not.toMatch(/ S\d/);
  });

  it("cuts a V-carve's flat bottom with its end mill first", () => {
    const doc = referenceProject();
    doc.operations = [
      {
        id: id(5),
        type: "vcarve",
        name: "Carve",
        enabled: true,
        stockSide: "top",
        targets: [{ shapeId: recess.id, paths: null }],
        tool: vBit,
        params: { maxDepth: 2, flatBottom: { tool: endMill, stepOver: 40 } },
      },
    ];
    const { gcode, warnings } = exportGcode(doc, "Plate");
    expect(warnings).toEqual([]);
    const clearing = gcode.indexOf("(Operation: Carve, clearing)");
    const carving = gcode.indexOf("(Operation: Carve)");
    expect(clearing).toBeGreaterThan(-1);
    expect(carving).toBeGreaterThan(clearing);
    expect(gcode.slice(clearing, carving)).toContain("M0 (Change the bit to 60° V-bit");
  });

  it("finishes a model from its mesh", () => {
    // A 100 × 80 mm plate with a flat top, which its placement puts at the stock top.
    const z = -4;
    const mesh = new Float32Array([
      ...[-50, -40, z, 50, -40, z, 50, 40, z, -50, -40, z, 50, 40, z, -50, 40, z],
      ...[-50, -40, -12, 50, -40, -12, 50, 40, -12],
    ]);
    const placed = {
      ...model,
      bounds: { min: [-50, -40, -12], max: [50, 40, z] } as typeof model.bounds,
    };
    // 18 mm of stock, deep enough for the 12 mm model.
    const reference = referenceProject();
    const doc = { ...reference, stock: { ...reference.stock, thickness: 18 }, models: [placed] };
    doc.operations = [{ ...reliefFinish, params: { ...reliefFinish.params, stepOver: 100 } }];
    const { gcode, warnings } = exportGcode(doc, "Relief", {
      mesh: (sha256) => (sha256 === model.sha256 ? mesh : undefined),
    });
    expect(warnings).toEqual([]);
    expect(gcode).toContain("(Operation: Finish)");
    // Down onto the flat top, and across it.
    expect(gcode).toContain("G1 Z0 F500\nG1 X99.963 F1500\n");
  });

  it("cuts a model deeper than the stock no deeper than its bottom, and says so", () => {
    const doc = { ...referenceProject(), models: [model], operations: [reliefRough] };
    const { gcode, warnings } = exportGcode(doc, "Relief", {
      mesh: (sha256) =>
        sha256 === model.sha256
          ? new Float32Array([
              -50, -40, -12, 50, -40, -12, 50, 40, -12, -50, 40, 0, -49, 40, 0, -50, 39, 0,
            ])
          : undefined,
    });
    expect(warnings).toEqual([{ operation: "Rough", message: { code: "toolpath.belowStock" } }]);
    expect(gcode).toContain("(Operation: Rough)");
  });

  it("roughs a model out before finishing it", () => {
    const mesh = new Float32Array([
      ...[-50, -40, -12, 50, -40, -12, 50, 40, -12, -50, -40, -12, 50, 40, -12, -50, 40, -12],
      ...[-50, -40, 0, -49.9, -40, 0, -50, -39.9, 0],
    ]);
    const reference = referenceProject();
    const doc = { ...reference, stock: { ...reference.stock, thickness: 18 }, models: [model] };
    doc.operations = [
      reliefRough,
      { ...reliefFinish, params: { ...reliefFinish.params, stepOver: 100 } },
    ];
    const { gcode, warnings } = exportGcode(doc, "Relief", {
      mesh: (sha256) => (sha256 === model.sha256 ? mesh : undefined),
    });
    expect(warnings).toEqual([]);
    const roughing = gcode.indexOf("(Operation: Rough)");
    expect(roughing).toBeGreaterThan(-1);
    expect(gcode.indexOf("(Operation: Finish)")).toBeGreaterThan(roughing);
  });

  it("leaves out a rest operation the operations before it left nothing for", () => {
    const mesh = new Float32Array([
      ...[-50, -40, -12, 50, -40, -12, 50, 40, -12, -50, -40, -12, 50, 40, -12, -50, 40, -12],
      ...[-50, -40, 0, -49.9, -40, 0, -50, -39.9, 0],
    ]);
    const reference = referenceProject();
    const doc = { ...reference, stock: { ...reference.stock, thickness: 18 }, models: [model] };
    doc.operations = [
      reliefRough,
      {
        ...reliefRough,
        id: "8b2f1c4d-5e6a-4b7c-9d8e-0f1a2b3c4d5e",
        name: "Rest",
        params: { ...reliefRough.params, rest: true },
      },
    ];
    const { gcode, warnings } = exportGcode(doc, "Relief", {
      mesh: (sha256) => (sha256 === model.sha256 ? mesh : undefined),
    });
    expect(gcode).toContain("(Operation: Rough)");
    expect(gcode).not.toContain("(Operation: Rest)");
    expect(warnings).toEqual([{ operation: "Rest", message: { code: "export.noToolpath" } }]);
  });

  it("includes the toolpath warnings, named by operation", () => {
    const doc = referenceProject();
    doc.operations = [
      {
        ...(doc.operations[0] as Operation),
        targets: [
          { shapeId: plate.id, paths: null },
          { shapeId: holes.id, paths: null },
        ],
      },
    ];
    expect(exportGcode(doc, "Plate").warnings).toEqual([
      {
        operation: "Holes",
        message: { code: "toolpath.skippedNonCircles", values: { count: 1 } },
      },
    ]);
  });

  it("warns about enabled operations left out for having no toolpath", () => {
    const doc = referenceProject();
    const [holes, ...rest] = doc.operations as [Operation, ...Operation[]];
    doc.operations = [{ ...holes, targets: [] }, ...rest];
    expect(exportGcode(doc, "Plate").warnings).toEqual([
      { operation: "Holes", message: { code: "export.noToolpath" } },
    ]);
  });

  it("refuses an operation that can't cut with its tool rather than leaving it out", () => {
    const doc = referenceProject();
    doc.operations = doc.operations.map((operation) =>
      operation.type === "profile" ? { ...operation, tool: drill } : operation,
    );
    expect(exportDetail(() => exportGcode(doc, "Plate"))).toEqual({
      operation: "Cut out",
      message: { code: "operation.drillsCantCutSideways" },
    });
  });

  it("refuses a project with nothing to cut", () => {
    const doc = referenceProject();
    expect(() =>
      exportGcode(
        { ...doc, operations: doc.operations.map((op) => ({ ...op, enabled: false })) },
        "Plate",
      ),
    ).toThrow("export.noEnabled");
    expect(() =>
      exportGcode(
        {
          ...doc,
          operations: [
            { ...(doc.operations[0] as Operation), targets: [{ shapeId: plate.id, paths: null }] },
          ],
        },
        "Plate",
      ),
    ).toThrow("export.noneHasToolpath");
  });
});

/** What `run` threw as a `GcodeExportError`. */
function exportDetail(run: () => unknown) {
  try {
    run();
  } catch (error) {
    if (error instanceof GcodeExportError) {
      const { operation, detail } = error;
      return { ...(operation !== undefined && { operation }), message: detail };
    }
    throw error;
  }
  throw new Error("Nothing was thrown");
}
