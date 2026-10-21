import { type Path, type Point, Shape } from "@furrow/document";
import { describe, expect, it } from "vitest";
import { flattenPath } from "../../geometry/flatten";
import inkscapeR12 from "./fixtures/inkscape-r12.dxf?raw";
import inkscapeR14 from "./fixtures/inkscape-r14.dxf?raw";
import {
  DxfImportError,
  type DxfImportOptions,
  dxfNeedsUnits,
  importDxf,
  MAX_DXF_ENTITIES,
  parseDxf,
} from "./import";

type Pair = [number, string | number];

/** Node and browsers have `TextEncoder`; the package's lib types don't include it. */
/** Tests importing a million entities, up to the cap: slow on a busy CI runner, so they get longer than the 5 s default. */
const CAP_TEST_TIMEOUT = 30_000;

const encoder = new (
  globalThis as unknown as { TextEncoder: new () => { encode(text: string): Uint8Array } }
).TextEncoder();
const utf8 = (text: string) => encoder.encode(text);

/** An entity's pairs, after its `0 TYPE` pair. */
function entity(type: string, ...pairs: Pair[]): Pair[] {
  return [[0, type], ...pairs];
}

/** A DXF file in millimetres unless `units` says otherwise. */
function dxf(
  entities: Pair[][],
  {
    units = 4,
    tables = [],
    blocks = [],
  }: { units?: number | null; tables?: Pair[][]; blocks?: Pair[][] } = {},
): string {
  const pairs: Pair[] = [];
  const section = (name: string, body: Pair[][]) => {
    pairs.push([0, "SECTION"], [2, name]);
    for (const record of body) pairs.push(...record);
    pairs.push([0, "ENDSEC"]);
  };
  section(
    "HEADER",
    units === null
      ? []
      : [
          [
            [9, "$INSUNITS"],
            [70, units],
          ],
        ],
  );
  if (tables.length > 0)
    section("TABLES", [
      [
        [0, "TABLE"],
        [2, "LAYER"],
      ],
      ...tables,
      [[0, "ENDTAB"]],
    ]);
  if (blocks.length > 0) section("BLOCKS", blocks);
  section("ENTITIES", entities);
  pairs.push([0, "EOF"]);
  return `${pairs.map(([code, value]) => `${String(code).padStart(3)}\n${value}`).join("\n")}\n`;
}

function layer(name: string, ...pairs: Pair[]): Pair[] {
  return entity("LAYER", [2, name], ...pairs);
}

function block(name: string, base: Point, ...entities: Pair[][]): Pair[] {
  return [
    ...entity("BLOCK", [2, name], [70, 0], [10, base[0]], [20, base[1]]),
    ...entities.flat(),
    ...entity("ENDBLK"),
  ];
}

const line = (x1: number, y1: number, x2: number, y2: number, ...pairs: Pair[]) =>
  // The first value of a code wins, so `pairs` can give another layer.
  entity("LINE", ...pairs, [8, "0"], [10, x1], [20, y1], [11, x2], [21, y2]);

/** Imports and checks every shape against the document schema. */
function shapesOf(text: string, options?: DxfImportOptions) {
  const result = importDxf(text, options);
  for (const shape of result.shapes) Shape.parse(shape);
  return result;
}

function importOne(...entities: Pair[][]) {
  const { shapes } = shapesOf(dxf(entities));
  expect(shapes).toHaveLength(1);
  return shapes[0] as Shape;
}

function bounds(paths: Path[]): { min: Point; max: Point } {
  const points = paths.flatMap((path) => flattenPath(path));
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return { min: [Math.min(...xs), Math.min(...ys)], max: [Math.max(...xs), Math.max(...ys)] };
}

function expectBounds(paths: Path[], min: Point, max: Point, digits = 6) {
  const box = bounds(paths);
  expect(box.min[0]).toBeCloseTo(min[0], digits);
  expect(box.min[1]).toBeCloseTo(min[1], digits);
  expect(box.max[0]).toBeCloseTo(max[0], digits);
  expect(box.max[1]).toBeCloseTo(max[1], digits);
}

describe("parseDxf", () => {
  it("rejects files that aren't DXF", () => {
    expect(() => parseDxf("<svg/>")).toThrow(DxfImportError);
    expect(() => parseDxf("0\nLINE\n")).toThrow(DxfImportError);
    expect(() => parseDxf("")).toThrow(DxfImportError);
  });

  it("rejects binary DXF", () => {
    const bytes = utf8("AutoCAD Binary DXF\r\n\u001a\u0000");
    expect(() => parseDxf(bytes)).toThrow("dxf.binary");
  });

  it("decodes files before AutoCAD 2007 with their code page", () => {
    const text = dxf([line(0, 0, 1, 0, [8, "Ébauche"])]).replace(
      "  9\n$INSUNITS",
      "  9\n$ACADVER\n  1\nAC1015\n  9\n$DWGCODEPAGE\n  3\nANSI_1252\n  9\n$INSUNITS",
    );
    const bytes = Uint8Array.from(text, (char) => char.charCodeAt(0));
    expect(importDxf(parseDxf(bytes)).shapes[0]?.layer).toBe("Ébauche");
  });

  it("decodes AutoCAD 2007 and later as UTF-8", () => {
    const text = dxf([line(0, 0, 1, 0, [8, "Ébauche"])]).replace(
      "  9\n$INSUNITS",
      "  9\n$ACADVER\n  1\nAC1021\n  9\n$DWGCODEPAGE\n  3\nANSI_1252\n  9\n$INSUNITS",
    );
    const document = parseDxf(utf8(text));
    expect(importDxf(document).shapes[0]?.layer).toBe("Ébauche");
  });

  it("warns about code pages it can't decode", () => {
    const text = dxf([line(0, 0, 1, 0)]).replace(
      "  9\n$INSUNITS",
      "  9\n$ACADVER\n  1\nAC1009\n  9\n$DWGCODEPAGE\n  3\nDOS850\n  9\n$INSUNITS",
    );
    const { warnings } = importDxf(parseDxf(utf8(text)));
    expect(warnings).toEqual([{ code: "dxf.codepage", values: { codepage: "DOS850" } }]);
  });

  it("finds the code page in files with CR line endings and padded names", () => {
    const text = dxf([line(0, 0, 1, 0, [8, "Слой"])])
      .replace(
        "  9\n$INSUNITS",
        "  9\n$ACADVER \n  1\nAC1015\n  9\n  $DWGCODEPAGE\n  3\nANSI_1251\n  9\n$INSUNITS",
      )
      .replaceAll("\n", "\r");
    // "Слой" in Windows-1251.
    const bytes = Uint8Array.from(text, (char) => {
      const code = char.charCodeAt(0);
      // Cyrillic А–я are 0xC0–0xFF in Windows-1251.
      return code < 128 ? code : code - 0x410 + 0xc0;
    });
    expect(importDxf(parseDxf(bytes)).shapes[0]?.layer).toBe("Слой");
  });

  it("decodes \\U+ escapes in names", () => {
    expect(importOne(line(0, 0, 1, 0, [8, "Caf\\U+00E9"])).layer).toBe("Café");
  });

  it("reads Windows line endings and padded values", () => {
    const text = dxf([line(0, 0, 10, 0)])
      .replaceAll("\n", "\r\n")
      .replace("10\r\n0", "10\r\n  0.0  ");
    expect(importDxf(text).shapes[0]?.paths[0]?.segments).toEqual([{ kind: "line", to: [10, 0] }]);
  });
});

describe("units", () => {
  it.each([
    [4, 1],
    [1, 25.4],
    [5, 10],
    [6, 1000],
    [2, 304.8],
  ])("reads $INSUNITS %i", (units, length) => {
    const { shapes } = importDxf(dxf([line(0, 0, 1, 0)], { units }));
    expect(shapes[0]?.paths[0]?.segments[0]?.to[0]).toBeCloseTo(length, 9);
    expect(dxfNeedsUnits(parseDxf(dxf([], { units })))).toBe(false);
  });

  it.each([
    ["missing", null],
    ["unitless", 0],
    ["unknown", 99],
  ])("asks when $INSUNITS is %s, reading the given units", (_, units) => {
    const text = dxf([line(0, 0, 1, 0)], { units });
    expect(dxfNeedsUnits(parseDxf(text))).toBe(true);
    expect(importDxf(text).shapes[0]?.paths[0]?.segments[0]?.to[0]).toBe(1);
    expect(importDxf(text, { units: "in" }).shapes[0]?.paths[0]?.segments[0]?.to[0]).toBeCloseTo(
      25.4,
      9,
    );
  });

  it("ignores the given units when the file states its own", () => {
    const { shapes } = importDxf(dxf([line(0, 0, 1, 0)], { units: 4 }), { units: "in" });
    expect(shapes[0]?.paths[0]?.segments[0]?.to[0]).toBe(1);
  });
});

describe("importDxf", () => {
  it("keeps the drawing's coordinates", () => {
    expect(importOne(line(-5, 3, 10, 3)).paths[0]).toEqual({
      start: [-5, 3],
      segments: [{ kind: "line", to: [10, 3] }],
      closed: false,
    });
  });

  it("imports points as single-point paths", () => {
    expect(importOne(entity("POINT", [8, "0"], [10, 4], [20, 5])).paths[0]).toEqual({
      start: [4, 5],
      segments: [],
      closed: false,
    });
  });

  it("imports circles as a full counterclockwise arc", () => {
    expect(importOne(entity("CIRCLE", [8, "0"], [10, 10], [20, 20], [40, 5])).paths[0]).toEqual({
      start: [15, 20],
      segments: [{ kind: "arc", to: [15, 20], center: [10, 20], clockwise: false }],
      closed: true,
    });
  });

  it("imports arcs counterclockwise from the start angle, across 0°", () => {
    const path = importOne(entity("ARC", [8, "0"], [10, 0], [20, 0], [40, 10], [50, 270], [51, 90]))
      .paths[0];
    expect(path?.start).toEqual([0, -10]);
    expect(path?.segments).toEqual([
      { kind: "arc", to: [0, 10], center: [0, 0], clockwise: false },
    ]);
    expect(path?.closed).toBe(false);
  });

  it("imports an arc from 0° to 360° as a circle", () => {
    const path = importOne(entity("ARC", [8, "0"], [10, 0], [20, 0], [40, 10], [50, 0], [51, 360]))
      .paths[0];
    expect(path?.closed).toBe(true);
    expect(path?.segments).toEqual([
      { kind: "arc", to: [10, 0], center: [0, 0], clockwise: false },
    ]);
  });

  it.each([
    [
      "an ARC ending just past 360°",
      entity("ARC", [8, "0"], [10, 0], [20, 0], [40, 10], [50, 0], [51, 360.0000001]),
    ],
    [
      "an ELLIPSE ending just past 2π",
      entity(
        "ELLIPSE",
        [8, "0"],
        [10, 0],
        [20, 0],
        [11, 10],
        [21, 0],
        [40, 1],
        [41, 0],
        [42, 6.28318530717959],
      ),
    ],
    [
      "an ELLIPSE ending just short of 2π",
      entity(
        "ELLIPSE",
        [8, "0"],
        [10, 0],
        [20, 0],
        [11, 10],
        [21, 0],
        [40, 1],
        [41, 0],
        [42, 6.2831853071795],
      ),
    ],
  ])("imports %s as a full circle", (_, circle) => {
    const path = importOne(circle).paths[0];
    expect(path?.closed).toBe(true);
    expect(path?.segments).toEqual([
      { kind: "arc", to: [10, 0], center: [0, 0], clockwise: false },
    ]);
  });

  it("imports polylines with bulges as arcs", () => {
    // A 20 × 10 slot: lines along the long sides, half circles (bulge 1) at the ends.
    const shape = importOne(
      entity(
        "LWPOLYLINE",
        [8, "0"],
        [90, 4],
        [70, 1],
        [10, 0],
        [20, 0],
        [10, 20],
        [20, 0],
        [42, 1],
        [10, 20],
        [20, 10],
        [10, 0],
        [20, 10],
        [42, 1],
      ),
    );
    expect(shape.paths[0]).toEqual({
      start: [0, 0],
      segments: [
        { kind: "line", to: [20, 0] },
        { kind: "arc", to: [20, 10], center: [20, 5], clockwise: false },
        { kind: "line", to: [0, 10] },
        { kind: "arc", to: [0, 0], center: [0, 5], clockwise: false },
      ],
      closed: true,
    });
  });

  it("turns negative bulges clockwise", () => {
    const path = importOne(
      entity(
        "LWPOLYLINE",
        [8, "0"],
        [90, 2],
        [70, 0],
        [10, 0],
        [20, 0],
        [42, -Math.tan(Math.PI / 8)],
        [10, 10],
        [20, 10],
      ),
    ).paths[0];
    const arc = path?.segments[0];
    expect(arc?.kind).toBe("arc");
    if (arc?.kind !== "arc") return;
    expect(arc.clockwise).toBe(true);
    expect(arc.center[0]).toBeCloseTo(10, 9);
    expect(arc.center[1]).toBeCloseTo(0, 9);
  });

  it("imports old-style polylines with their vertices", () => {
    const shape = importOne(
      entity("POLYLINE", [8, "0"], [66, 1], [70, 1]),
      entity("VERTEX", [8, "0"], [10, 0], [20, 0]),
      entity("VERTEX", [8, "0"], [10, 10], [20, 0]),
      entity("VERTEX", [8, "0"], [10, 10], [20, 10]),
      entity("SEQEND", [8, "0"]),
    );
    expect(shape.paths[0]).toEqual({
      start: [0, 0],
      segments: [
        { kind: "line", to: [10, 0] },
        { kind: "line", to: [10, 10] },
        { kind: "line", to: [0, 0] },
      ],
      closed: true,
    });
  });

  it("drops a spline-fitted polyline's frame", () => {
    const shape = importOne(
      entity("POLYLINE", [8, "0"], [66, 1], [70, 4]),
      entity("VERTEX", [8, "0"], [10, 0], [20, 0], [70, 8]),
      entity("VERTEX", [8, "0"], [10, 50], [20, 50], [70, 16]),
      entity("VERTEX", [8, "0"], [10, 10], [20, 0], [70, 8]),
      entity("SEQEND", [8, "0"]),
    );
    expect(shape.paths[0]?.segments).toEqual([{ kind: "line", to: [10, 0] }]);
  });

  it("skips polyface meshes", () => {
    const { shapes, warnings } = shapesOf(
      dxf([
        entity("POLYLINE", [8, "0"], [66, 1], [70, 64]),
        entity("VERTEX", [8, "0"], [10, 0], [20, 0]),
        entity("VERTEX", [8, "0"], [10, 10], [20, 0]),
        entity("SEQEND", [8, "0"]),
      ]),
    );
    expect(shapes).toEqual([]);
    expect(warnings).toEqual([{ code: "dxf.skip.faces", values: { count: 1 } }]);
  });

  it("imports ellipses as cubics on the ellipse", () => {
    const shape = importOne(
      entity(
        "ELLIPSE",
        [8, "0"],
        [10, 50],
        [20, 50],
        [11, 20],
        [21, 0],
        [40, 0.5],
        [41, 0],
        [42, 2 * Math.PI],
      ),
    );
    const [path] = shape.paths;
    expect(path?.closed).toBe(true);
    expect(path?.segments.every((segment) => segment.kind === "cubic")).toBe(true);
    expectBounds(shape.paths, [30, 40], [70, 60], 2);
  });

  it("keeps a circular ellipse as an arc", () => {
    const shape = importOne(
      entity(
        "ELLIPSE",
        [8, "0"],
        [10, 0],
        [20, 0],
        [11, 0],
        [21, 5],
        [40, 1],
        [41, 0],
        [42, Math.PI],
      ),
    );
    expect(shape.paths[0]).toEqual({
      start: [0, 5],
      segments: [{ kind: "arc", to: [0, -5], center: [0, 0], clockwise: false }],
      closed: false,
    });
  });

  it("imports splines from their control points", () => {
    const shape = importOne(
      entity(
        "SPLINE",
        [8, "0"],
        [70, 8],
        [71, 3],
        [72, 8],
        [73, 4],
        ...[0, 0, 0, 0, 1, 1, 1, 1].map((knot): Pair => [40, knot]),
        [10, 0],
        [20, 0],
        [30, 0],
        [10, 10],
        [20, 20],
        [30, 0],
        [10, 30],
        [20, 20],
        [30, 0],
        [10, 40],
        [20, 0],
        [30, 0],
      ),
    );
    expect(shape.paths[0]).toEqual({
      start: [0, 0],
      segments: [{ kind: "cubic", c1: [10, 20], c2: [30, 20], to: [40, 0] }],
      closed: false,
    });
  });

  it("skips splines with only fit points", () => {
    const { shapes, warnings } = shapesOf(
      dxf([entity("SPLINE", [8, "0"], [71, 3], [74, 2], [11, 0], [21, 0], [11, 10], [21, 10])]),
    );
    expect(shapes).toEqual([]);
    expect(warnings).toEqual([{ code: "dxf.skip.fitSplines", values: { count: 1 } }]);
  });

  it("mirrors entities whose extrusion is -Z, as Fusion writes them", () => {
    // In the object coordinate system of an extrusion of -Z, x points left.
    const path = importOne(
      entity(
        "ARC",
        [8, "0"],
        [10, 10],
        [20, 0],
        [40, 5],
        [50, 0],
        [51, 90],
        [210, 0],
        [220, 0],
        [230, -1],
      ),
    ).paths[0];
    expect(path?.start).toEqual([-15, 0]);
    expect(path?.segments).toEqual([
      { kind: "arc", to: [-10, 5], center: [-10, 0], clockwise: true },
    ]);
  });

  it("skips entities tilted out of the XY plane", () => {
    const { shapes, warnings } = shapesOf(
      dxf([entity("CIRCLE", [8, "0"], [10, 0], [20, 0], [40, 5], [210, 0], [220, 1], [230, 1])]),
    );
    expect(shapes).toEqual([]);
    expect(warnings).toEqual([{ code: "dxf.skip.tilted", values: { count: 1 } }]);
  });

  it("ignores Z", () => {
    expect(importOne(line(0, 0, 10, 0, [30, 5], [31, -3])).paths[0]?.segments).toEqual([
      { kind: "line", to: [10, 0] },
    ]);
  });

  it("keeps layer names", () => {
    expect(importOne(line(0, 0, 1, 0, [8, "Cut outside"])).layer).toBe("Cut outside");
  });

  it("skips entities on layers that are off or frozen", () => {
    const { shapes, warnings } = shapesOf(
      dxf(
        [
          line(0, 0, 1, 0, [8, "Off"]),
          line(0, 0, 1, 0, [8, "Frozen"]),
          line(0, 5, 1, 5, [8, "On"]),
        ],
        {
          tables: [
            layer("Off", [62, -7], [70, 0]),
            layer("FROZEN", [62, 7], [70, 1]),
            layer("On", [62, 7], [70, 0]),
          ],
        },
      ),
    );
    expect(shapes.map((shape) => shape.layer)).toEqual(["On"]);
    expect(warnings).toEqual([{ code: "dxf.skip.layersOff", values: { count: 2 } }]);
  });

  it("skips invisible and paper-space entities", () => {
    const { shapes, warnings } = shapesOf(
      dxf([line(0, 0, 1, 0, [60, 1]), line(0, 0, 1, 0, [67, 1]), line(0, 5, 1, 5)]),
    );
    expect(shapes).toHaveLength(1);
    expect(warnings).toEqual([{ code: "dxf.skip.paperSpace", values: { count: 1 } }]);
  });

  it("reports what it can't import", () => {
    const { warnings } = shapesOf(
      dxf([
        entity("TEXT", [8, "0"], [1, "Hello"]),
        entity("MTEXT", [8, "0"], [1, "Hello"]),
        entity("DIMENSION", [8, "0"], [2, "*D1"]),
        entity("HATCH", [8, "0"]),
        entity("HELIX", [8, "0"]),
      ]),
    );
    expect(warnings).toEqual([
      { code: "dxf.skip.text", values: { count: 2 } },
      { code: "dxf.skip.dimensions", values: { count: 1 } },
      { code: "dxf.skip.hatches", values: { count: 1 } },
      { code: "dxf.skip.entityType", values: { type: "HELIX", count: 1 } },
    ]);
  });

  it("skips entities with invalid coordinates", () => {
    const { shapes, warnings } = shapesOf(
      dxf([line(0, 0, 1, 0).map(([code, value]) => [code, code === 11 ? "x" : value])]),
    );
    expect(shapes).toEqual([]);
    expect(warnings).toEqual([{ code: "dxf.skip.invalidCoordinates", values: { count: 1 } }]);
  });

  it("names shapes with their source file", () => {
    const { shapes } = importDxf(dxf([line(0, 0, 1, 0)]), { fileName: "part.dxf" });
    expect(shapes[0]?.source).toBe("part.dxf");
  });
});

describe("block references", () => {
  const square = block(
    "Square",
    [5, 5],
    entity(
      "LWPOLYLINE",
      [8, "0"],
      [90, 4],
      [70, 1],
      [10, 5],
      [20, 5],
      [10, 15],
      [20, 5],
      [10, 15],
      [20, 15],
      [10, 5],
      [20, 15],
    ),
  );

  it("places a block at its insertion point, from its base point", () => {
    const { shapes } = shapesOf(
      dxf([entity("INSERT", [8, "Parts"], [2, "Square"], [10, 100], [20, 50])], {
        blocks: [square],
      }),
    );
    expect(shapes).toHaveLength(1);
    expect(shapes[0]?.name).toBe("Square");
    // Entities on layer 0 take the reference's layer.
    expect(shapes[0]?.layer).toBe("Parts");
    expectBounds(shapes[0]?.paths ?? [], [100, 50], [110, 60]);
  });

  it("rotates and scales around the insertion point", () => {
    const { shapes } = shapesOf(
      dxf(
        [entity("INSERT", [8, "0"], [2, "Square"], [10, 0], [20, 0], [41, 2], [42, 2], [50, 90])],
        { blocks: [square] },
      ),
    );
    expectBounds(shapes[0]?.paths ?? [], [-20, 0], [0, 20]);
  });

  it("repeats a block in rows and columns", () => {
    const { shapes } = shapesOf(
      dxf(
        [
          entity(
            "INSERT",
            [8, "0"],
            [2, "Square"],
            [10, 0],
            [20, 0],
            [70, 3],
            [71, 2],
            [44, 20],
            [45, 30],
          ),
        ],
        {
          blocks: [square],
        },
      ),
    );
    expect(shapes).toHaveLength(6);
    expectBounds(
      shapes.flatMap((shape) => shape.paths),
      [0, 0],
      [50, 40],
    );
  });

  it("turns circles into cubics under an uneven scale", () => {
    const { shapes } = shapesOf(
      dxf([entity("INSERT", [8, "0"], [2, "Hole"], [10, 0], [20, 0], [41, 2], [42, 1])], {
        blocks: [block("Hole", [0, 0], entity("CIRCLE", [8, "0"], [10, 0], [20, 0], [40, 5]))],
      }),
    );
    const path = shapes[0]?.paths[0];
    expect(path?.segments.every((segment) => segment.kind === "cubic")).toBe(true);
    expectBounds(shapes[0]?.paths ?? [], [-10, -5], [10, 5], 2);
  });

  it("flips arcs under a mirroring scale", () => {
    const { shapes } = shapesOf(
      dxf([entity("INSERT", [8, "0"], [2, "Arc"], [10, 0], [20, 0], [41, -1], [42, 1])], {
        blocks: [
          block(
            "Arc",
            [0, 0],
            entity("ARC", [8, "0"], [10, 0], [20, 0], [40, 5], [50, 0], [51, 90]),
          ),
        ],
      }),
    );
    expect(shapes[0]?.paths[0]).toEqual({
      start: [-5, 0],
      segments: [{ kind: "arc", to: [0, 5], center: [0, 0], clockwise: true }],
      closed: false,
    });
  });

  it("draws nested blocks and skips blocks that contain themselves", () => {
    const { shapes, warnings } = shapesOf(
      dxf([entity("INSERT", [8, "0"], [2, "Outer"], [10, 10], [20, 0])], {
        blocks: [
          square,
          block(
            "Outer",
            [0, 0],
            entity("INSERT", [8, "0"], [2, "Square"], [10, 0], [20, 0]),
            entity("INSERT", [8, "0"], [2, "Outer"]),
          ),
        ],
      }),
    );
    expect(shapes).toHaveLength(1);
    expectBounds(shapes[0]?.paths ?? [], [10, 0], [20, 10]);
    expect(warnings).toEqual([{ code: "dxf.skip.recursiveBlocks", values: { count: 1 } }]);
  });

  it("reports references to missing blocks", () => {
    expect(shapesOf(dxf([entity("INSERT", [8, "0"], [2, "Nowhere"])])).warnings).toEqual([
      { code: "dxf.skip.missingBlocks", values: { count: 1 } },
    ]);
  });

  it("stops after too many entities", { timeout: CAP_TEST_TIMEOUT }, () => {
    // Ten references to ten references to … a line: 10^6 lines.
    const blocks = [block("L0", [0, 0], line(0, 0, 1, 0))];
    for (let level = 1; level <= 6; level++) {
      const references = Array.from({ length: 10 }, () =>
        entity("INSERT", [8, "0"], [2, `L${level - 1}`]),
      );
      blocks.push(block(`L${level}`, [0, 0], ...references));
    }
    const { warnings } = importDxf(dxf([entity("INSERT", [8, "0"], [2, "L6"])], { blocks }));
    expect(warnings).toContainEqual({
      code: "dxf.tooManyEntities",
      values: { max: MAX_DXF_ENTITIES },
    });
  });

  it("stops a huge array at the cap", { timeout: CAP_TEST_TIMEOUT }, () => {
    const { warnings } = importDxf(
      dxf([entity("INSERT", [8, "0"], [2, "Dot"], [70, 32767], [71, 32767], [44, 1], [45, 1])], {
        blocks: [block("Dot", [0, 0], entity("POINT", [8, "0"], [10, 0], [20, 0]))],
      }),
    );
    expect(warnings).toHaveLength(1);
  });

  it("doesn't warn about a drawing of exactly the cap", { timeout: CAP_TEST_TIMEOUT }, () => {
    // The reference and its MAX_DXF_ENTITIES - 1 copies of a point.
    const { shapes, warnings } = importDxf(
      dxf([entity("INSERT", [8, "0"], [2, "Dot"], [70, MAX_DXF_ENTITIES - 1], [44, 1])], {
        blocks: [block("Dot", [0, 0], entity("POINT", [8, "0"], [10, 0], [20, 0]))],
      }),
    );
    expect(shapes).toHaveLength(MAX_DXF_ENTITIES - 1);
    expect(warnings).toEqual([]);
  });
});

describe("joining", () => {
  it("joins a chain of more entities than fit in a function call's arguments", () => {
    const count = 150_000;
    const { shapes } = importDxf(
      dxf([entity("INSERT", [8, "0"], [2, "Step"], [70, count], [44, 1])], {
        blocks: [block("Step", [0, 0], line(0, 0, 1, 0))],
      }),
    );
    expect(shapes).toHaveLength(1);
    expect(shapes[0]?.paths[0]?.segments).toHaveLength(count);
  });

  it("joins layers whose names differ only in case, as DXF does", () => {
    const { shapes } = shapesOf(
      dxf([line(0, 0, 10, 0, [8, "Cut"]), line(10, 0, 10, 10, [8, "CUT"])], {
        tables: [layer("cut", [62, 7], [70, 0])],
      }),
    );
    expect(shapes).toHaveLength(1);
    // The layer table's spelling.
    expect(shapes[0]?.layer).toBe("cut");
  });

  it("joins lines whose ends meet into a closed path, whatever their direction", () => {
    const { shapes } = shapesOf(
      dxf([line(0, 0, 10, 0), line(10, 10, 10, 0), line(10, 10, 0, 10), line(0, 0, 0, 10)]),
    );
    expect(shapes).toHaveLength(1);
    expect(shapes[0]?.paths[0]).toEqual({
      start: [0, 0],
      segments: [
        { kind: "line", to: [10, 0] },
        { kind: "line", to: [10, 10] },
        { kind: "line", to: [0, 10] },
        { kind: "line", to: [0, 0] },
      ],
      closed: true,
    });
  });

  it("reverses arcs it joins backwards", () => {
    // The arc runs counterclockwise from (0, 0) to (10, 0), below the line.
    const { shapes } = shapesOf(
      dxf([
        line(0, 0, 10, 0),
        entity("ARC", [8, "0"], [10, 5], [20, 0], [40, 5], [50, 180], [51, 360]),
      ]),
    );
    expect(shapes).toHaveLength(1);
    expect(shapes[0]?.paths[0]).toEqual({
      start: [0, 0],
      segments: [
        { kind: "line", to: [10, 0] },
        { kind: "arc", to: [0, 0], center: [5, 0], clockwise: true },
      ],
      closed: true,
    });
  });

  it("joins ends within the geometry tolerance", () => {
    const { shapes } = shapesOf(dxf([line(0, 0, 10, 0), line(10.0005, 0, 10, 10)]));
    expect(shapes).toHaveLength(1);
  });

  it("leaves branches alone", () => {
    const { shapes } = shapesOf(dxf([line(0, 0, 10, 0), line(10, 0, 20, 0), line(10, 0, 10, 10)]));
    expect(shapes).toHaveLength(3);
  });

  it("doesn't join across layers", () => {
    const { shapes } = shapesOf(dxf([line(0, 0, 10, 0, [8, "A"]), line(10, 0, 20, 0, [8, "B"])]));
    expect(shapes.map((shape) => shape.layer)).toEqual(["A", "B"]);
  });

  it("closes a single entity that ends where it starts", () => {
    const shape = importOne(
      entity(
        "LWPOLYLINE",
        [8, "0"],
        [90, 4],
        [70, 0],
        [10, 0],
        [20, 0],
        [10, 10],
        [20, 0],
        [10, 10],
        [20, 10],
        [10, 0],
        [20, 0],
      ),
    );
    expect(shape.paths[0]?.closed).toBe(true);
  });

  it("keeps shapes in drawing order", () => {
    const { shapes } = shapesOf(
      dxf([
        line(0, 0, 10, 0, [8, "A"]),
        entity("CIRCLE", [8, "B"], [10, 50], [20, 50], [40, 5]),
        line(10, 0, 10, 10, [8, "A"]),
      ]),
    );
    expect(shapes.map((shape) => shape.layer)).toEqual(["A", "B"]);
  });
});

describe("real exports", () => {
  // The same part drawn in Inkscape (120 × 80 mm page): a 100 × 60 rounded rectangle on
  // "Outline", four r4 holes on "Holes" and a 52 × 12 slot on "Pocket".
  function expectPart(shapes: Shape[]) {
    expect(shapes.map((shape) => shape.layer)).toEqual([
      "Outline",
      "Holes",
      "Holes",
      "Holes",
      "Holes",
      "Pocket",
    ]);
    expect(shapes.every((shape) => shape.paths.length === 1 && shape.paths[0]?.closed)).toBe(true);
    const [outline, hole, , , , slot] = shapes.map((shape) => shape.paths);
    expectBounds(outline ?? [], [10, 10], [110, 70], 2);
    expectBounds(slot ?? [], [34, 34], [86, 46], 2);
    const box = bounds(hole ?? []);
    // R12 writes circles as 24-gons, a little narrower than the circle.
    expect(box.max[0] - box.min[0]).toBeCloseTo(8, 1);
  }

  it("imports Inkscape's R14 export (splines and polylines, in millimetres)", () => {
    expect(dxfNeedsUnits(parseDxf(inkscapeR14))).toBe(false);
    const { shapes, warnings } = shapesOf(inkscapeR14);
    expect(warnings).toEqual([]);
    expectPart(shapes);
  });

  it("imports Inkscape's R12 export (flattened polylines, with no units)", () => {
    expect(dxfNeedsUnits(parseDxf(inkscapeR12))).toBe(true);
    const { shapes, warnings } = shapesOf(inkscapeR12, { units: "mm" });
    expect(warnings).toEqual([]);
    expectPart(shapes);
  });
});
