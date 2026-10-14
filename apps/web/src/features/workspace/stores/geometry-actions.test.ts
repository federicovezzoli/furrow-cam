import { anchorPoint, importDxf, importSvg, shapesBounds } from "@furrow/cam-core";
import { createProjectDocument, StockAnchor } from "@furrow/document";
import { describe, expect, it } from "vitest";
import { createDocumentStore } from "./document-store";
import { addImportedShapes } from "./geometry-actions";
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

type Store = ReturnType<typeof createDocumentStore>;

/** A 600 × 400 mm stock zeroed at `anchor`. */
function storeAt(anchor: StockAnchor) {
  const store = createDocumentStore(createProjectDocument());
  setXYAnchor(store, anchor);
  return store;
}

/** The point of the drawing's bounding box that `anchor` names. */
function drawingAnchor(store: Store, anchor: StockAnchor) {
  const bounds = shapesBounds(store.getState().document.geometry);
  if (!bounds) throw new Error("No drawing");
  return anchorPoint(bounds, anchor);
}

const stockAnchor = (anchor: StockAnchor) => anchorPoint({ min: [0, 0], max: [600, 400] }, anchor);

describe("addImportedShapes", () => {
  it.each(StockAnchor.options)("aligns a DXF drawing to the stock at %s", (anchor) => {
    const store = storeAt(anchor);
    const before = store.getState().past.length;
    expect(addImportedShapes(store, "importDxf", importDxf(DXF).shapes)).toBe(true);
    expect(drawingAnchor(store, anchor)).toEqual(stockAnchor(anchor));
    expect(store.getState().past).toHaveLength(before + 1);
  });

  it.each(StockAnchor.options)("aligns an SVG drawing, not its page, at %s", (anchor) => {
    const store = storeAt(anchor);
    addImportedShapes(store, "importSvg", importSvg(SVG).shapes);
    expect(drawingAnchor(store, anchor)).toEqual(stockAnchor(anchor));
  });

  it("aligns at the stock's bottom-left corner under a custom zero", () => {
    const store = storeAt("center");
    pickXYOrigin(store, [-20, 35.5]);
    addImportedShapes(store, "importDxf", importDxf(DXF).shapes);
    expect(drawingAnchor(store, "bottom_left")).toEqual([0, 0]);
    expect(store.getState().document.stock.xyOrigin).toEqual({ anchor: "custom", x: -20, y: 35.5 });
  });

  it("takes one file per project, and undoes as one step", () => {
    const store = storeAt("center");
    addImportedShapes(store, "importDxf", importDxf(DXF).shapes);
    const { document, past } = store.getState();
    expect(addImportedShapes(store, "importSvg", importSvg(SVG).shapes)).toBe(false);
    expect(store.getState().document).toBe(document);
    expect(store.getState().past).toHaveLength(past.length);
    store.getState().undo();
    expect(store.getState().document.geometry).toEqual([]);
  });
});
