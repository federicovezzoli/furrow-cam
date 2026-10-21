import { anchorPoint, importDxf, importSvg } from "@furrow/cam-core";
import { createProjectDocument, ProjectDocument, StockAnchor } from "@furrow/document";
import {
  CIRCLE_ID,
  DRAWING_ID,
  fullDocument,
  model,
  reliefFinish,
  SQUARE_ID,
  square,
} from "@furrow/document/fixtures";
import { describe, expect, it } from "vitest";
import { createDocumentStore } from "./document-store";
import { drawingAnchor } from "./drawing-test-utils";
import { addImportedShapes, canImportModel, removeDrawing } from "./geometry-actions";
import { pickXYOrigin, setXYAnchor } from "./stock-actions";

/** A DXF with a 20 mm circle centred on `(0, 0)`. */
const DXF = [
  "0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n4\n0\nENDSEC",
  "0\nSECTION\n2\nENTITIES\n0\nCIRCLE\n8\n0\n10\n0\n20\n0\n40\n10\n0\nENDSEC",
  "0\nEOF\n",
].join("\n");

/** An SVG on a 100 × 50 mm page with a 30 × 10 mm rectangle away from its corner. */
const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="50mm" viewBox="0 0 100 50"><rect x="40" y="20" width="30" height="10"/></svg>';

/** A 600 × 400 mm stock zeroed at `anchor`. */
function storeAt(anchor: StockAnchor) {
  const store = createDocumentStore(createProjectDocument());
  setXYAnchor(store, anchor);
  return store;
}

const stockAnchor = (anchor: StockAnchor) => anchorPoint({ min: [0, 0], max: [600, 400] }, anchor);

describe("addImportedShapes", () => {
  it.each(StockAnchor.options)("aligns a DXF drawing to the stock at %s", (anchor) => {
    const store = storeAt(anchor);
    const before = store.getState().past.length;
    addImportedShapes(store, "importDxf", importDxf(DXF).shapes);
    expect(drawingAnchor(store.getState().document, anchor)).toEqual(stockAnchor(anchor));
    expect(store.getState().past).toHaveLength(before + 1);
  });

  it.each(StockAnchor.options)("aligns an SVG drawing, not its page, at %s", (anchor) => {
    const store = storeAt(anchor);
    addImportedShapes(store, "importSvg", importSvg(SVG).shapes);
    expect(drawingAnchor(store.getState().document, anchor)).toEqual(stockAnchor(anchor));
  });

  it("aligns at the stock's bottom-left corner under a custom zero", () => {
    const store = storeAt("center");
    pickXYOrigin(store, [-20, 35.5]);
    addImportedShapes(store, "importDxf", importDxf(DXF).shapes);
    expect(drawingAnchor(store.getState().document, "bottom_left")).toEqual([0, 0]);
    expect(store.getState().document.stock.xyOrigin).toEqual({ anchor: "custom", x: -20, y: 35.5 });
  });

  it("adds no touch-off pad", () => {
    const store = storeAt("bottom_left");
    addImportedShapes(store, "importDxf", importDxf(DXF).shapes);
    expect(store.getState().document.stock.touchOff).toBeNull();
  });

  it("keeps a touch-off pad the project already has", () => {
    const document = createProjectDocument();
    document.stock.touchOff = { x: 300, y: 200, diameter: 20, toolChange: null };
    const store = createDocumentStore(document);
    addImportedShapes(store, "importDxf", importDxf(DXF).shapes);
    expect(store.getState().document.stock.touchOff).toEqual({
      x: 300,
      y: 200,
      diameter: 20,
      toolChange: null,
    });
  });

  it("adds each file as a drawing named after it, aligned on its own, in one undo step", () => {
    const store = storeAt("bottom_left");
    addImportedShapes(store, "importDxf", importDxf(DXF, { fileName: "hole.dxf" }).shapes);
    const before = store.getState().past.length;
    addImportedShapes(store, "importSvg", importSvg(SVG, { fileName: "part.svg" }).shapes);
    const { document, past } = store.getState();
    expect(past).toHaveLength(before + 1);
    expect(document.drawings.map(({ name, border }) => ({ name, border }))).toEqual([
      { name: "hole.dxf", border: 10 },
      { name: "part.svg", border: 10 },
    ]);
    const [hole, part] = document.drawings;
    expect(document.geometry.map((shape) => shape.drawingId)).toEqual([hole?.id, part?.id]);
    // Each one sits at the zero's anchor, overlapping the other.
    for (const shape of document.geometry) {
      expect(shape.paths[0]?.start.every((value) => value >= 0)).toBe(true);
    }
    expect(ProjectDocument.parse(document)).toEqual(document);
    store.getState().undo();
    expect(store.getState().document.drawings).toHaveLength(1);
  });

  it("refuses a drawing in a project with an STL model, and a model once it has drawings", () => {
    const store = createDocumentStore({ ...createProjectDocument(), models: [model] });
    const { document } = store.getState();
    expect(addImportedShapes(store, "importSvg", importSvg(SVG).shapes)).toBe(false);
    expect(store.getState().document).toBe(document);
    expect(canImportModel(document)).toBe(false);
    expect(canImportModel(fullDocument())).toBe(false);
    expect(canImportModel(createProjectDocument())).toBe(true);
  });
});

describe("removeDrawing", () => {
  /** `fullDocument` with a second drawing, a model, and operations on each. */
  function document() {
    const doc = fullDocument();
    const other = "0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e";
    const line = { ...square, id: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d", drawingId: other };
    const profile = doc.operations[0];
    if (!profile) throw new Error("fixture");
    doc.drawings.push({ id: other, name: "other.svg", border: 10 });
    doc.geometry.push(line);
    doc.models = [model];
    doc.operations = [
      profile,
      {
        ...profile,
        id: "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e",
        targets: [{ shapeId: line.id, paths: null }],
      },
      {
        ...profile,
        id: "3c4d5e6f-7a8b-4c9d-8e0f-2a3b4c5d6e7f",
        targets: [
          { shapeId: SQUARE_ID, paths: null },
          { shapeId: line.id, paths: null },
        ],
      },
      reliefFinish,
    ];
    return doc;
  }

  it("removes its shapes, their targets and the operations left with none, in one undo step", () => {
    const store = createDocumentStore(document());
    removeDrawing(store, DRAWING_ID);
    const doc = store.getState().document;
    expect(doc.drawings.map((drawing) => drawing.name)).toEqual(["other.svg"]);
    expect(doc.geometry.map((shape) => shape.id)).toEqual(["1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d"]);
    expect(doc.operations.map((operation) => operation.targets.map((t) => t.shapeId))).toEqual([
      ["1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d"],
      ["1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d"],
      [],
    ]);
    expect(doc.operations.at(-1)).toEqual(reliefFinish);
    expect(ProjectDocument.parse(doc)).toEqual(doc);
    store.getState().undo();
    expect(store.getState().document).toEqual(document());
  });

  it("does nothing for an unknown drawing", () => {
    const store = createDocumentStore(document());
    removeDrawing(store, CIRCLE_ID);
    expect(store.getState().past).toHaveLength(0);
  });
});
