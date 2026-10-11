import { describe, expect, it } from "vitest";
import { createProjectDocument, ProjectDocument, StockAnchor, XYOrigin } from "./document";
import { fullDocument, OPERATION_ID, SQUARE_ID } from "./fixtures";

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
    expect(ProjectDocument.safeParse({ ...doc, schemaVersion: 2 }).success).toBe(false);
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
    const twice = { ...operation, shapeIds: [SQUARE_ID, SQUARE_ID] };
    expect(ProjectDocument.safeParse({ ...doc, operations: [twice] }).success).toBe(false);
    const dangling = { ...operation, shapeIds: ["11111111-2222-4333-8444-555555555555"] };
    expect(ProjectDocument.safeParse({ ...doc, operations: [dangling] }).success).toBe(false);
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
      shapeIds: [SQUARE_ID],
      tool: doc.operations[0]?.tool,
      params: { stepOver: 40 },
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
      },
      machine: null,
      geometry: [],
      operations: [],
    });
  });

  it("returns a fresh object each time", () => {
    expect(createProjectDocument()).not.toBe(createProjectDocument());
  });
});
