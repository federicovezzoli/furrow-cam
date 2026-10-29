import { describe, expect, it } from "vitest";
import { createProjectDocument, ProjectDocument, Stock, StockAnchor, XYOrigin } from "./document";
import {
  fullDocument,
  model,
  OPERATION_ID,
  reliefFinish,
  reliefRough,
  SQUARE_ID,
  textItem,
  textShape,
  uploadedFont,
} from "./fixtures";
import type { TextSettings } from "./geometry";

describe("ProjectDocument", () => {
  it("accepts a document with machine, geometry and operations", () => {
    const doc = fullDocument();
    expect(ProjectDocument.parse(doc)).toEqual(doc);
  });

  it("round-trips through JSON", () => {
    const doc = fullDocument();
    expect(ProjectDocument.parse(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
  });

  it("rejects invalid stock and unknown versions", () => {
    const doc = fullDocument();
    expect(ProjectDocument.safeParse({ ...doc, stock: { ...doc.stock, width: 0 } }).success).toBe(
      false,
    );
    expect(
      ProjectDocument.safeParse({ ...doc, stock: { ...doc.stock, xyOrigin: "left" } }).success,
    ).toBe(false);
    expect(ProjectDocument.safeParse({ ...doc, schemaVersion: 1 }).success).toBe(false);
  });

  it("rejects duplicate ids and references to missing shapes", () => {
    const doc = fullDocument();
    const [square] = doc.geometry;
    const [operation] = doc.operations;
    if (!square || !operation) throw new Error("fixture");

    expect(ProjectDocument.safeParse({ ...doc, geometry: [square, square] }).success).toBe(false);
    expect(ProjectDocument.safeParse({ ...doc, operations: [operation, operation] }).success).toBe(
      false,
    );
    const whole = { shapeId: SQUARE_ID, paths: null };
    const twice = { ...operation, targets: [whole, whole] };
    expect(ProjectDocument.safeParse({ ...doc, operations: [twice] }).success).toBe(false);
    const dangling = {
      ...operation,
      targets: [{ shapeId: "11111111-2222-4333-8444-555555555555", paths: null }],
    };
    expect(ProjectDocument.safeParse({ ...doc, operations: [dangling] }).success).toBe(false);
  });

  it("checks that shapes and drawings name each other", () => {
    const doc = fullDocument();
    const [drawing] = doc.drawings;
    if (!drawing) throw new Error("fixture");
    const other = { ...drawing, id: "0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e", name: "empty.svg" };
    expect(ProjectDocument.safeParse({ ...doc, drawings: [drawing, other] }).error?.issues).toEqual(
      [expect.objectContaining({ path: ["drawings", 1], message: "document.emptyDrawing" })],
    );
    expect(
      ProjectDocument.safeParse({ ...doc, drawings: [drawing, drawing] }).error?.issues,
    ).toEqual([
      expect.objectContaining({
        path: ["drawings", 1, "id"],
        message: "document.duplicateDrawing",
      }),
    ]);
    expect(ProjectDocument.safeParse({ ...doc, drawings: [] }).error?.issues).toEqual([
      expect.objectContaining({
        path: ["geometry", 0, "drawingId"],
        message: "document.unknownDrawing",
      }),
      expect.objectContaining({
        path: ["geometry", 1, "drawingId"],
        message: "document.unknownDrawing",
      }),
    ]);
  });

  it("accepts text items with exactly one shape and valid settings", () => {
    const doc = fullDocument();
    const withText = {
      ...doc,
      drawings: [...doc.drawings, textItem],
      geometry: [...doc.geometry, textShape],
    };
    expect(ProjectDocument.parse(withText)).toEqual(withText);
    const second = { ...textShape, id: "9c5e3a7b-4d2f-4b0c-9e8d-6f1a2b3c4d5e" };
    expect(
      ProjectDocument.safeParse({ ...withText, geometry: [...withText.geometry, second] }).error
        ?.issues,
    ).toEqual([expect.objectContaining({ path: ["drawings", 1], message: "document.textShapes" })]);
    const text = (fields: object) => ({
      ...withText,
      drawings: [...doc.drawings, { ...textItem, text: { ...textItem.text, ...fields } }],
    });
    expect(ProjectDocument.safeParse(text({ text: " \n" })).error?.issues).toEqual([
      expect.objectContaining({
        path: ["drawings", 1, "text", "text"],
        message: "validation.blank",
      }),
    ]);
    expect(ProjectDocument.safeParse(text({ height: 0 })).success).toBe(false);
    expect(ProjectDocument.safeParse(text({ letterSpacing: -0.5 })).success).toBe(true);
    expect(ProjectDocument.safeParse(text({ letterSpacing: -0.6 })).success).toBe(false);
    for (const rotation of [-90, 360]) {
      const placement = { ...textItem.text?.placement, rotation };
      expect(ProjectDocument.safeParse(text({ placement })).success).toBe(false);
    }
    expect(ProjectDocument.safeParse(text({ font: "" })).success).toBe(false);
    expect(ProjectDocument.safeParse(text({ align: "justify" })).success).toBe(false);
  });

  it("accepts uploaded fonts that text uses, and rejects duplicates, unknown ones and too many", () => {
    const doc = fullDocument();
    const onFont = {
      ...textItem,
      text: { ...(textItem.text as TextSettings), font: uploadedFont.sha256 },
    };
    const withFont = {
      ...doc,
      drawings: [...doc.drawings, onFont],
      geometry: [...doc.geometry, textShape],
      fonts: [uploadedFont],
    };
    expect(ProjectDocument.parse(withFont)).toEqual(withFont);
    expect(ProjectDocument.safeParse({ ...withFont, fonts: [] }).error?.issues).toEqual([
      expect.objectContaining({
        path: ["drawings", 1, "text", "font"],
        message: "document.unknownFont",
      }),
    ]);
    expect(
      ProjectDocument.safeParse({ ...withFont, fonts: [uploadedFont, uploadedFont] }).error?.issues,
    ).toEqual([
      expect.objectContaining({ path: ["fonts", 1, "sha256"], message: "document.duplicateFont" }),
    ]);
    const others = ["a", "b", "c", "d"].map((c) => ({ ...uploadedFont, sha256: c.repeat(64) }));
    expect(
      ProjectDocument.safeParse({ ...withFont, fonts: [uploadedFont, ...others] }).error?.issues,
    ).toEqual([expect.objectContaining({ path: ["fonts"], message: "document.tooManyFonts" })]);
    // A bundled font's id isn't a hash, and needs no upload.
    expect(
      ProjectDocument.safeParse({ ...withFont, fonts: [], drawings: [...doc.drawings, textItem] })
        .success,
    ).toBe(true);
  });

  it("accepts models and rejects duplicate model ids", () => {
    const doc = { ...fullDocument(), models: [model] };
    expect(ProjectDocument.parse(doc)).toEqual(doc);
    const copy = { ...model, fileName: "copy.stl" };
    expect(ProjectDocument.safeParse({ ...doc, models: [model, copy] }).error?.issues).toEqual([
      expect.objectContaining({ path: ["models", 1, "id"], message: "document.duplicateModel" }),
    ]);
  });

  it("checks the model a 3D operation machines", () => {
    const doc = { ...fullDocument(), models: [model], operations: [reliefRough, reliefFinish] };
    expect(ProjectDocument.parse(doc)).toEqual(doc);
    expect(ProjectDocument.safeParse({ ...doc, models: [] }).error?.issues).toEqual([
      expect.objectContaining({
        path: ["operations", 0, "params", "modelId"],
        message: "document.unknownModel",
      }),
      expect.objectContaining({
        path: ["operations", 1, "params", "modelId"],
        message: "document.unknownModel",
      }),
    ]);
  });

  it("checks the targeted paths", () => {
    const doc = fullDocument();
    const [operation] = doc.operations;
    if (!operation) throw new Error("fixture");
    const parse = (paths: unknown) =>
      ProjectDocument.safeParse({
        ...doc,
        operations: [{ ...operation, targets: [{ shapeId: SQUARE_ID, paths }] }],
      });
    expect(parse(null).success).toBe(true);
    expect(parse([0]).success).toBe(true);
    // The square has a single path.
    expect(parse([1]).error?.issues.map((issue) => issue.path)).toEqual([
      ["operations", 0, "targets", 0, "paths", 0],
    ]);
    for (const paths of [[], [-1], [0.5], [0, 0], undefined]) {
      expect(parse(paths).success).toBe(false);
    }
  });

  it("rejects unknown keys and blank operation names", () => {
    const doc = fullDocument();
    const [operation] = doc.operations;
    expect(ProjectDocument.safeParse({ ...doc, extra: true }).success).toBe(false);
    expect(ProjectDocument.safeParse({ ...doc, stock: { ...doc.stock, depth: 1 } }).success).toBe(
      false,
    );
    expect(
      ProjectDocument.safeParse({ ...doc, operations: [{ ...operation, name: " " }] }).success,
    ).toBe(false);
  });

  it("rejects params a pocket doesn't define", () => {
    const doc = fullDocument();
    const operation = {
      id: OPERATION_ID,
      type: "pocket",
      name: "Pocket",
      enabled: true,
      stockSide: "top",
      targets: [{ shapeId: SQUARE_ID, paths: null }],
      tool: doc.operations[0]?.tool,
      params: { leadIn: { radius: 3 } },
    };
    expect(ProjectDocument.safeParse({ ...doc, operations: [operation] }).success).toBe(false);
  });
});

describe("XYOrigin", () => {
  it("accepts the 9 stock anchors", () => {
    for (const anchor of StockAnchor.options) {
      expect(XYOrigin.parse({ anchor })).toEqual({ anchor });
    }
  });

  it("accepts custom zeros anywhere, including outside the stock", () => {
    for (const [x, y] of [
      [25, 40],
      [0, 0],
      [-12.5, 1000],
    ]) {
      expect(XYOrigin.parse({ anchor: "custom", x, y })).toEqual({ anchor: "custom", x, y });
    }
  });

  it("normalises legacy anchor names", () => {
    expect(XYOrigin.parse("bottom_left")).toEqual({ anchor: "bottom_left" });
    expect(XYOrigin.parse("center")).toEqual({ anchor: "center" });
    const doc = fullDocument();
    const legacy = { ...doc, stock: { ...doc.stock, xyOrigin: "center" } };
    expect(ProjectDocument.parse(legacy)).toEqual(doc);
  });

  it("rejects non-finite or missing custom coordinates", () => {
    for (const origin of [
      { anchor: "custom", x: Number.NaN, y: 0 },
      { anchor: "custom", x: 0, y: Number.POSITIVE_INFINITY },
      { anchor: "custom", x: Number.NEGATIVE_INFINITY, y: 0 },
      { anchor: "custom", x: 0 },
      { anchor: "custom", x: "1", y: 0 },
    ]) {
      expect(XYOrigin.safeParse(origin).success).toBe(false);
    }
  });

  it("reports the invalid field of a custom zero", () => {
    const result = XYOrigin.safeParse({ anchor: "custom", x: Number.NaN, y: 0 });
    expect(result.error?.issues.map((issue) => issue.path)).toEqual([["x"]]);
    const missing = XYOrigin.safeParse({ anchor: "custom", x: 0 });
    expect(missing.error?.issues.map((issue) => issue.path)).toEqual([["y"]]);
  });

  it("rejects unknown anchors, coordinates on anchors and other legacy-looking names", () => {
    for (const origin of [
      { anchor: "left" },
      { anchor: "center", x: 0, y: 0 },
      { anchor: "custom", x: 0, y: 0, z: 0 },
      "top_right",
      "custom",
      null,
    ]) {
      expect(XYOrigin.safeParse(origin).success).toBe(false);
    }
  });
});

describe("Stock", () => {
  const stock = fullDocument().stock;

  it("accepts a touch-off pad on the stock, or none", () => {
    expect(Stock.safeParse(stock).success).toBe(true);
    expect(Stock.safeParse({ ...stock, touchOff: null }).success).toBe(true);
    // As wide as the stock's smaller side, and off the stock: the pad lying
    // outside it is a warning, not an error.
    const widest = { x: 100, y: 100, diameter: 200, toolChange: null };
    expect(Stock.safeParse({ ...stock, touchOff: widest }).success).toBe(true);
    const off = { x: -50, y: 10, diameter: 15, toolChange: "G0 X{padX} Y{padY}\nM0" };
    expect(Stock.safeParse({ ...stock, touchOff: off }).success).toBe(true);
  });

  it("rejects pads with no diameter, wider than the stock, or a blank tool change", () => {
    for (const touchOff of [
      { x: 10, y: 10, diameter: 0, toolChange: null },
      { x: 10, y: 10, diameter: 201, toolChange: null },
      { x: 10, y: 10, toolChange: null },
      { x: 10, y: 10, diameter: 15 },
      { x: 10, y: 10, diameter: 15, toolChange: " \n" },
      { x: 10, y: 10, diameter: 15, toolChange: null, z: 0 },
    ]) {
      expect(Stock.safeParse({ ...stock, touchOff }).success).toBe(false);
    }
    const wide = { x: 10, y: 10, diameter: 201, toolChange: null };
    expect(Stock.safeParse({ ...stock, touchOff: wide }).error?.issues).toEqual([
      expect.objectContaining({ path: ["touchOff", "diameter"] }),
    ]);
  });
});

describe("two-sided projects", () => {
  it("cut each side down to a parting plane inside the stock", () => {
    const stock = fullDocument().stock;
    expect(
      Stock.safeParse({ ...stock, twoSided: { flipAxis: "y", partingDepth: 17.9 } }).success,
    ).toBe(true);
    for (const twoSided of [
      { flipAxis: "x", partingDepth: 18 },
      { flipAxis: "x", partingDepth: 0 },
      { flipAxis: "z", partingDepth: 9 },
      { flipAxis: "x" },
    ]) {
      expect(Stock.safeParse({ ...stock, twoSided }).success).toBe(false);
    }
    const below = { flipAxis: "x", partingDepth: 20 };
    expect(Stock.safeParse({ ...stock, twoSided: below }).error?.issues).toEqual([
      expect.objectContaining({ path: ["twoSided", "partingDepth"] }),
    ]);
  });

  it("put operations on the bottom side, which one-sided projects don't have", () => {
    const doc = fullDocument();
    doc.operations = doc.operations.map((operation) => ({ ...operation, stockSide: "bottom" }));
    expect(ProjectDocument.safeParse(doc).success).toBe(true);
    const oneSided = { ...doc, stock: { ...doc.stock, twoSided: null } };
    expect(ProjectDocument.safeParse(oneSided).error?.issues).toEqual(
      doc.operations.map((_, i) =>
        expect.objectContaining({
          path: ["operations", i, "stockSide"],
          message: "document.bottomSideOneSided",
        }),
      ),
    );
  });

  it("let a model reach through the whole stock", () => {
    const doc = fullDocument();
    doc.models = [{ ...model, placement: { ...model.placement, depth: doc.stock.thickness } }];
    expect(ProjectDocument.safeParse(doc).success).toBe(true);
  });
});

describe("createProjectDocument", () => {
  it("returns a valid empty project with the default stock", () => {
    const doc = createProjectDocument();
    expect(ProjectDocument.parse(doc)).toEqual(doc);
    expect(doc).toMatchObject({
      units: "mm",
      stock: {
        width: 600,
        height: 400,
        thickness: 18,
        xyOrigin: { anchor: "bottom_left" },
        zOrigin: "stock_top",
        touchOff: null,
        twoSided: null,
      },
      machine: null,
      geometry: [],
      models: [],
      fonts: [],
      operations: [],
    });
  });

  it("returns a fresh object each time", () => {
    expect(createProjectDocument()).not.toBe(createProjectDocument());
  });
});
