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
import { oneFile } from "./export-test-utils";
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
    fonts: [],
    operations: [
      {
        id: id(2),
        type: "drill",
        name: "Holes",
        enabled: true,
        stockSide: "top",
        targets: [{ shapeId: holes.id, paths: null }],
        tool: drill,
        params: { depth: 6, peck: true, stepOver: 40, pins: false },
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
    const { gcode, warnings, fileName } = oneFile(exportGcode(referenceProject(), "Plate"));
    expect(fileName).toBe("Plate.gcode");
    expect(warnings).toEqual([]);
    expect(gcode).toContain("(Operation: Cut out)");
    expect(gcode).not.toContain("Disabled");
  });

  describe("two-sided projects", () => {
    // The fixture model as a flat block, placed at a quarter of its 100 × 80 mm.
    const mesh = new Float32Array([
      ...[-50, -40, 0, 50, -40, 0, 50, 40, 0, -50, -40, 0, 50, 40, 0, -50, 40, 0],
      ...[-50, -40, -12, 50, 40, -12, 50, -40, -12, -50, -40, -12, -50, 40, -12, 50, 40, -12],
    ]);
    const context = { mesh: () => mesh };
    const placed = {
      ...model,
      bounds: { min: [-50, -40, -12], max: [50, 40, 0] } as typeof model.bounds,
      placement: { ...model.placement, scale: 0.25, depth: 3 },
    };
    function twoSided(operations: Operation[]) {
      const doc = referenceProject();
      const stock = {
        ...doc.stock,
        thickness: 18,
        twoSided: { flipAxis: "x" as const, partingDepth: 9, pins: null, edges: null },
      };
      return { ...doc, stock, models: [placed], operations };
    }
    const [plate] = referenceProject().operations;
    const rough = (stockSide: Operation["stockSide"], name: string): Operation => ({
      ...reliefRough,
      id: crypto.randomUUID(),
      name,
      stockSide,
      // Past the block's edges, so each side roughs around it.
      params: { ...reliefRough.params, boundary: { type: "margin", distance: 10 } },
    });

    it("exports one file per side, each saying what to do", () => {
      const doc = twoSided([
        plate as Operation,
        rough("top", "Top rough"),
        rough("bottom", "Bottom rough"),
      ]);
      const { files } = exportGcode(doc, "Owl", context);
      expect(files.map((file) => file.fileName)).toEqual(["Owl-top.gcode", "Owl-bottom.gcode"]);
      const [top, bottom] = files.map((file) => file.gcode);
      expect(top).toContain("(Two-sided: top side, cut first)");
      expect(top).toContain(
        "(Then turn the stock over by half a turn about its centre line along X, in place, and run the bottom side's file)",
      );
      expect(top).toContain("(Operation: Top rough)");
      expect(top).toContain(`(Operation: ${plate?.name})`);
      expect(top).not.toContain("Bottom rough");
      expect(bottom).toContain("(Two-sided: bottom side, cut second)");
      expect(bottom).toContain("(Run the top side's file first)");
      // The top side's file may end with another bit.
      expect(bottom).toContain(`(Load ${endMill.name}, ${endMill.diameter} mm)`);
      expect(bottom).toContain(
        "(Zero: X Y at the bottom-left corner of the stock, Z at the stock top)",
      );
      expect(bottom).toContain("(Zero as for the top side, Z on the face now on top)");
      expect(bottom).toContain("(Operation: Bottom rough)");
      expect(bottom).not.toContain("Top rough");
    });

    it("turns the stock over onto its locating pins once the top side drills them", () => {
      const pinDrill: Operation = {
        ...(plate as Operation),
        id: crypto.randomUUID(),
        type: "drill",
        tool: drill,
        targets: [],
        params: { depth: 1, peck: false, stepOver: 40, pins: true },
      };
      const holes = { type: "through" as const, spoilboardDepth: 5 };
      const pins = { diameter: 6, positions: [-120, 120], holes };
      const withPins = (operations: Operation[]) => {
        const doc = twoSided(operations);
        const stock = {
          ...doc.stock,
          twoSided: { flipAxis: "y" as const, partingDepth: 9, pins, edges: null },
        };
        return exportGcode({ ...doc, stock }, "Owl", context).files.at(-1)?.gcode;
      };
      expect(withPins([pinDrill, rough("bottom", "Bottom rough")])).toContain(
        "(Before this file, turn the stock over by half a turn about its centre line along Y, onto its 2 locating pins of 6 mm, so the face that was underneath is on top)",
      );
      // Pins set but never drilled: nothing to turn it over onto.
      for (const operations of [
        [rough("bottom", "Bottom rough")],
        [{ ...pinDrill, enabled: false }, rough("bottom", "Bottom rough")],
      ]) {
        expect(withPins(operations)).toContain("along Y, in place, so the face");
      }
    });

    it.each([
      ["x", "height", "Y", "200"],
      ["y", "width", "X", "300"],
    ] as const)(
      "says which corner to push into the fence corner and the size the sides meet by, about %s",
      (flipAxis, _, along, size) => {
        const doc = twoSided([rough("top", "Top rough"), rough("bottom", "Bottom rough")]);
        const stock = {
          ...doc.stock,
          width: 300,
          height: 200,
          xyOrigin: { anchor: "center" as const },
          twoSided: { flipAxis, partingDepth: 9, pins: null, edges: "bottom_right" as const },
        };
        const [top, bottom] = exportGcode({ ...doc, stock }, "Owl", context).files.map(
          (file) => file.gcode,
        );
        const fence =
          "(Line up: push the stock's bottom-right corner into the fence corner, the XY zero at X-150 Y100 mm from it)";
        expect(top).toContain(fence);
        expect(top).toContain(
          `along ${flipAxis.toUpperCase()}, with its bottom-right corner in the fence corner, and run`,
        );
        expect(bottom).toContain(fence);
        expect(bottom).toContain(
          `(The sides only meet if the stock is ${size} mm along ${along}: measure it)`,
        );
      },
    );

    it("names an untitled project's files after its sides", () => {
      const { files } = exportGcode(twoSided([rough("top", "Top rough")]), " ", context);
      expect(files.map((file) => file.fileName)).toEqual(["project-top.gcode"]);
    });

    it("says what both sides' programs say once", () => {
      const doc = twoSided([rough("top", "Top rough"), rough("bottom", "Bottom rough")]);
      const machine = {
        ...(doc.machine as NonNullable<typeof doc.machine>),
        programStart: "(At {nowhere})",
      };
      const { warnings } = exportGcode({ ...doc, machine }, "Owl", context);
      expect(
        warnings.filter(({ message }) => message.code === "grbl.unfilledPlaceholder"),
      ).toHaveLength(1);
    });

    it("keeps a machine-bed zero at the bed on the bottom side", () => {
      const doc = twoSided([rough("bottom", "Bottom rough")]);
      const bed = { ...doc, stock: { ...doc.stock, zOrigin: "machine_bed" as const } };
      const [bottom] = exportGcode(bed, "Owl", context).files;
      expect(bottom?.gcode).toContain("(Zero as for the top side, Z still at the machine bed)");
      expect(bottom?.gcode).not.toContain("face now on top");
    });

    it("exports only the side that has something to cut", () => {
      const { files } = exportGcode(twoSided([rough("top", "Top rough")]), "Owl", context);
      expect(files.map((file) => file.fileName)).toEqual(["Owl-top.gcode"]);
      expect(files[0]?.gcode).not.toContain("Then turn");
    });

    it("exports 2D operations on the bottom side, on the drawing seen from below", () => {
      const doc = twoSided([{ ...(plate as Operation), stockSide: "bottom" }]);
      const { files } = exportGcode(doc, "Owl", context);
      expect(files.map((file) => file.fileName)).toEqual(["Owl-bottom.gcode"]);
      expect(files[0]?.gcode).toContain(`(Operation: ${plate?.name})`);
    });
  });

  it("writes no spindle speeds for a manual spindle", () => {
    const doc = referenceProject();
    doc.machine = lowRider;
    const { gcode } = oneFile(exportGcode(doc, "Plate"));
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
    const { gcode, warnings } = oneFile(exportGcode(doc, "Plate"));
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
    const { gcode, warnings } = oneFile(
      exportGcode(doc, "Relief", {
        mesh: (sha256) => (sha256 === model.sha256 ? mesh : undefined),
      }),
    );
    expect(warnings).toEqual([]);
    expect(gcode).toContain("(Operation: Finish)");
    // Down onto the flat top, and across it.
    expect(gcode).toContain("G1 Z0 F500\nG1 X99.963 F1500\n");
  });

  it("cuts a model deeper than the stock no deeper than its bottom, and says so", () => {
    const doc = { ...referenceProject(), models: [model], operations: [reliefRough] };
    const { gcode, warnings } = oneFile(
      exportGcode(doc, "Relief", {
        mesh: (sha256) =>
          sha256 === model.sha256
            ? new Float32Array([
                -50, -40, -12, 50, -40, -12, 50, 40, -12, -50, 40, 0, -49, 40, 0, -50, 39, 0,
              ])
            : undefined,
      }),
    );
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
    const { gcode, warnings } = oneFile(
      exportGcode(doc, "Relief", {
        mesh: (sha256) => (sha256 === model.sha256 ? mesh : undefined),
      }),
    );
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
    const { gcode, warnings } = oneFile(
      exportGcode(doc, "Relief", {
        mesh: (sha256) => (sha256 === model.sha256 ? mesh : undefined),
      }),
    );
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
