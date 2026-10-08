import { describe, expect, it } from "vitest";
import { createProjectDocument, ProjectDocument } from "./document";
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
      ProjectDocument.safeParse({ ...doc, stock: { ...doc.stock, xyOrigin: "top_right" } }).success,
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

  it("rejects params on operations until their types define them", () => {
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
        xyOrigin: "bottom_left",
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
