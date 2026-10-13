import {
  createProjectDocument,
  type Operation,
  type Path,
  type Point,
  type ProjectDocument,
  type Shape,
} from "@furrow/document";
import { drill, endMill, lowRider, machine as shapeoko } from "@furrow/document/fixtures";
import { describe, expect, it } from "vitest";
import { exportGcode } from "./export";

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
  return { id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, name, layer: "0", paths };
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
    },
    machine: shapeoko,
    geometry: [plate, holes, recess],
    operations: [
      {
        id: id(2),
        type: "drill",
        name: "Holes",
        enabled: true,
        targets: [{ shapeId: holes.id, paths: null }],
        tool: drill,
        params: { depth: 6, peck: true },
      },
      {
        id: id(3),
        type: "pocket",
        name: "Recess",
        enabled: true,
        targets: [{ shapeId: recess.id, paths: null }],
        tool: endMill,
        params: { direction: "climb", depth: 3, allowance: 0, finishPass: false, ramp: true },
      },
      profile,
      { ...profile, id: id(4), name: "Disabled", enabled: false },
    ],
  };
}

describe("exportGcode", () => {
  it("posts the reference project for a Shapeoko", async () => {
    const { gcode, warnings, fileName } = exportGcode(referenceProject(), "Plate");
    expect(fileName).toBe("Plate.gcode");
    expect(warnings).toEqual([]);
    expect(gcode).not.toContain("Disabled");
    await expect(gcode).toMatchFileSnapshot("__snapshots__/plate-shapeoko.gcode");
  });

  it("posts the reference project for a LowRider, zeroed at the centre of the bed", async () => {
    const doc = referenceProject();
    doc.machine = lowRider;
    doc.stock.xyOrigin = { anchor: "center" };
    doc.stock.zOrigin = "machine_bed";
    const { gcode } = exportGcode(doc, "Plate");
    expect(gcode).not.toMatch(/ S\d/);
    await expect(gcode).toMatchFileSnapshot("__snapshots__/plate-lowrider.gcode");
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
      "Holes: Skipped 1 path: drilling needs circles or points.",
    ]);
  });

  it("warns about enabled operations left out for having no toolpath", () => {
    const doc = referenceProject();
    const [holes, ...rest] = doc.operations as [Operation, ...Operation[]];
    doc.operations = [{ ...holes, targets: [] }, ...rest];
    expect(exportGcode(doc, "Plate").warnings).toEqual([
      "Holes: no toolpath, left out of the program.",
    ]);
  });

  it("refuses a project with nothing to cut", () => {
    const doc = referenceProject();
    expect(() =>
      exportGcode(
        { ...doc, operations: doc.operations.map((op) => ({ ...op, enabled: false })) },
        "Plate",
      ),
    ).toThrow("There are no enabled operations to export.");
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
    ).toThrow("None of the enabled operations has a toolpath to export.");
  });
});
