import {
  anchorPoint,
  closedLoops,
  importDxf,
  importSvg,
  nearestOnLoops,
  translateShape,
} from "@furrow/cam-core";
import {
  createProjectDocument,
  type Path,
  type Point,
  ProjectDocument,
  StockAnchor,
  type TextSettings,
} from "@furrow/document";
import {
  CIRCLE_ID,
  circle,
  DRAWING_ID,
  fullDocument,
  model,
  reliefFinish,
  SQUARE_ID,
  square,
  TEXT_ID,
  textItem,
  textShape,
} from "@furrow/document/fixtures";
import { describe, expect, it } from "vitest";
import { createDocumentStore } from "./document-store";
import { drawingAnchor } from "./drawing-test-utils";
import {
  addImportedShapes,
  addTextItem,
  canImportModel,
  DUPLICATE_GAP,
  drawingBounds,
  drawingOffset,
  drawingOperations,
  drawingShapes,
  duplicateDrawing,
  fitDrawingToStock,
  mirrorDrawing,
  moveDrawing,
  removeDrawing,
  rotateDrawing,
  setDrawingBorder,
  setDrawingOffset,
  setDrawingSize,
  setTextItem,
} from "./geometry-actions";
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

/** Where a drawing lands at `anchor`: on the stock less the 10 mm border. */
const stockAnchor = (anchor: StockAnchor) =>
  anchorPoint({ min: [10, 10], max: [590, 390] }, anchor);

describe("addImportedShapes", () => {
  it.each(StockAnchor.options)("aligns a DXF drawing, its border in, at %s", (anchor) => {
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

  it("aligns at the bottom-left, its border in, under a custom zero", () => {
    const store = storeAt("center");
    pickXYOrigin(store, [-20, 35.5]);
    addImportedShapes(store, "importDxf", importDxf(DXF).shapes);
    expect(drawingAnchor(store.getState().document, "bottom_left")).toEqual([10, 10]);
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

  it("adds more shapes than a function call takes arguments, as one undo step", () => {
    const store = storeAt("bottom_left");
    const [hole] = importDxf(DXF).shapes;
    if (!hole) throw new Error("fixture");
    const shapes = Array.from({ length: 150_000 }, (_, i) => ({ ...hole, id: String(i) }));
    const before = store.getState().past.length;
    expect(addImportedShapes(store, "importDxf", shapes)).toBe(true);
    expect(store.getState().document.geometry).toHaveLength(150_000);
    expect(store.getState().past).toHaveLength(before + 1);
    // 150,000 shapes take seconds on a slow CI runner.
  }, 30_000);

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

const OTHER_SQUARE = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";

describe("duplicateDrawing", () => {
  it("copies it to the right with fresh ids, its targets and tabs, in one undo step", () => {
    const store = createDocumentStore(fullDocument());
    const before = drawingBounds(fullDocument().geometry, DRAWING_ID);
    if (!before) throw new Error("fixture");
    const copyId = duplicateDrawing(store, DRAWING_ID);
    const doc = store.getState().document;
    expect(copyId).not.toBeNull();
    expect(copyId).not.toBe(DRAWING_ID);
    expect(doc.drawings[1]).toEqual({ id: copyId, name: "part.dxf", border: 10 });

    const copies = drawingShapes(doc.geometry, copyId as string);
    const [copySquare, copyCircle] = copies;
    if (!copySquare || !copyCircle) throw new Error("no copy");
    expect(copies.map((shape) => shape.id)).not.toContain(SQUARE_ID);
    expect(copySquare.id).not.toBe(copyCircle.id);
    const dx = before.max[0] - before.min[0] + DUPLICATE_GAP;
    expect(copySquare).toEqual({
      ...translateShape(square, [dx, 0]),
      id: copySquare.id,
      drawingId: copyId,
    });
    expect(copyCircle).toEqual({
      ...translateShape(circle, [dx, 0]),
      id: copyCircle.id,
      drawingId: copyId,
    });

    const [profile] = doc.operations;
    expect(profile?.targets).toEqual([
      { shapeId: SQUARE_ID, paths: null },
      { shapeId: CIRCLE_ID, paths: [0] },
      { shapeId: copySquare.id, paths: null },
      { shapeId: copyCircle.id, paths: [0] },
    ]);
    expect(profile?.type === "profile" && profile.params.tabs?.positions).toEqual([
      [50, 0],
      [50 + dx, 0],
    ]);
    expect(ProjectDocument.parse(doc)).toEqual(doc);
    expect(store.getState().past).toHaveLength(1);
    store.getState().undo();
    expect(store.getState().document).toEqual(fullDocument());
  });

  it("leaves the copy's targets and tabs when the original is removed", () => {
    const store = createDocumentStore(fullDocument());
    const copyId = duplicateDrawing(store, DRAWING_ID) as string;
    const copy = store.getState().document.operations[0];
    removeDrawing(store, DRAWING_ID);
    const doc = store.getState().document;
    expect(doc.drawings.map((drawing) => drawing.id)).toEqual([copyId]);
    const [profile] = doc.operations;
    expect(profile?.targets).toEqual(copy?.targets.slice(2));
    expect(profile?.type === "profile" && profile.params.tabs?.positions).toEqual(
      copy?.type === "profile" && copy.params.tabs?.positions.slice(1),
    );
  });

  it("copies more targets than a function call takes arguments", () => {
    const doc = fullDocument();
    doc.geometry = Array.from({ length: 150_000 }, (_, i) => ({ ...circle, id: String(i) }));
    const [profile] = doc.operations;
    if (profile?.type !== "profile") throw new Error("fixture");
    profile.targets = doc.geometry.map(({ id }) => ({ shapeId: id, paths: null }));
    profile.params.tabs = null;
    const store = createDocumentStore(doc);
    expect(duplicateDrawing(store, DRAWING_ID)).not.toBeNull();
    expect(store.getState().document.operations[0]?.targets).toHaveLength(300_000);
    expect(store.getState().past).toHaveLength(1);
  }, 30_000);

  it("copies a tab that lies on an uncut path of another drawing", () => {
    const doc = fullDocument();
    const other = "0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e";
    doc.drawings.push({ id: other, name: "other.svg", border: 10 });
    // Its first path, the one cut, is the circle; its second lies on the square, under the tab.
    doc.geometry.push({
      ...square,
      id: OTHER_SQUARE,
      drawingId: other,
      paths: [...circle.paths, ...square.paths],
    });
    const [profile] = doc.operations;
    if (profile?.type !== "profile") throw new Error("fixture");
    profile.targets = [
      { shapeId: SQUARE_ID, paths: null },
      { shapeId: OTHER_SQUARE, paths: [0] },
    ];
    const store = createDocumentStore(doc);
    duplicateDrawing(store, DRAWING_ID);
    const [copied] = store.getState().document.operations;
    expect(copied?.type === "profile" && copied.params.tabs?.positions).toHaveLength(2);
  });

  it("does nothing for an unknown drawing", () => {
    const store = createDocumentStore(fullDocument());
    expect(duplicateDrawing(store, CIRCLE_ID)).toBeNull();
    expect(store.getState().past).toHaveLength(0);
  });
});

describe("drawing size", () => {
  /** `fullDocument`, zeroed at the bottom-left, with a second drawing holding a copy of the square far off. */
  function store() {
    const doc = fullDocument();
    doc.stock.xyOrigin = { anchor: "bottom_left" };
    const other = "0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e";
    doc.drawings.push({ id: other, name: "other.svg", border: 10 });
    // The same square, 150 mm to the right.
    const copy = translateShape({ ...square, id: OTHER_SQUARE, drawingId: other }, [150, 0]);
    doc.geometry.push(copy);
    return createDocumentStore(doc);
  }

  it("drops the tabs on a removed drawing's paths, keeping the others", () => {
    const s = store();
    s.getState().change("setup", (draft) => {
      const [profile] = draft.operations;
      if (profile?.type !== "profile" || !profile.params.tabs) throw new Error("fixture");
      profile.targets.push({ shapeId: OTHER_SQUARE, paths: null });
      profile.params.tabs.positions.push([200, 0]);
    });
    removeDrawing(s, DRAWING_ID);
    const [profile] = s.getState().document.operations;
    expect(profile?.targets).toEqual([{ shapeId: OTHER_SQUARE, paths: null }]);
    expect(profile?.type === "profile" && profile.params.tabs?.positions).toEqual([[200, 0]]);
  });
  const size = (s: ReturnType<typeof store>) => {
    const bounds = drawingBounds(s.getState().document.geometry, DRAWING_ID);
    if (!bounds) throw new Error("no drawing");
    return { bounds, width: bounds.max[0] - bounds.min[0], height: bounds.max[1] - bounds.min[1] };
  };

  it("scales both ways about the anchor point in one undo step, moving the tabs on its paths", () => {
    const s = store();
    const before = size(s);
    const otherBefore = s.getState().document.geometry[2];
    expect(setDrawingSize(s, DRAWING_ID, "width", before.width * 2)).toEqual({ ok: true });
    const after = size(s);
    expect(after.width).toBeCloseTo(before.width * 2, 6);
    expect(after.height).toBeCloseTo(before.height * 2, 6);
    expect(after.bounds.min).toEqual(before.bounds.min);
    expect(s.getState().past).toHaveLength(1);
    // The tab at (50, 0) on the square's bottom edge doubles its distance from the corner.
    const [profile] = s.getState().document.operations;
    expect(profile?.type === "profile" && profile.params.tabs?.positions).toEqual([[100, 0]]);
    expect(s.getState().document.geometry[2]).toBe(otherBefore);
    expect(ProjectDocument.parse(s.getState().document)).toEqual(s.getState().document);
  });

  it("keeps the point at the zero's anchor in place", () => {
    const s = store();
    setXYAnchor(s, "top_right");
    const corner = anchorPoint(size(s).bounds, "top_right");
    setDrawingSize(s, DRAWING_ID, "height", 50);
    // A cubic's top is found numerically, so it matches to a nanometre.
    const [x, y] = anchorPoint(size(s).bounds, "top_right");
    expect(x).toBeCloseTo(corner[0], 6);
    expect(y).toBeCloseTo(corner[1], 6);
    expect(size(s).height).toBeCloseTo(50, 6);
  });

  it("refuses a size that shrinks lines to nothing, changing nothing", () => {
    const s = store();
    const { document } = s.getState();
    expect(setDrawingSize(s, DRAWING_ID, "width", 0.0001)).toEqual({
      ok: false,
      error: { code: "workspace.drawingTooSmall" },
    });
    expect(s.getState().document).toBe(document);
  });

  it("fits inside the stock less the border, at the anchor", () => {
    const s = store();
    setDrawingBorder(s, DRAWING_ID, 20);
    fitDrawingToStock(s, DRAWING_ID);
    const { bounds, width, height } = size(s);
    expect(bounds.min[0]).toBeCloseTo(20, 6);
    expect(bounds.min[1]).toBeCloseTo(20, 6);
    // 300 × 200 stock less 20 mm: the height limits it.
    expect(height).toBeCloseTo(160, 6);
    expect(width).toBeLessThanOrEqual(260);
    expect(s.getState().past).toHaveLength(2);
  });

  /** Profile 0 cut down to `targets`, with tabs at `positions`. */
  function withProfile(
    s: ReturnType<typeof store>,
    targets: { shapeId: string; paths: null }[],
    positions: Point[],
  ) {
    s.getState().change("setup", (draft) => {
      const [profile] = draft.operations;
      if (profile?.type !== "profile" || !profile.params.tabs) throw new Error("fixture");
      profile.targets = targets;
      profile.params.tabs.positions = positions;
    });
  }
  const tabsOf = (s: ReturnType<typeof store>) => {
    const [profile] = s.getState().document.operations;
    return profile?.type === "profile" ? profile.params.tabs?.positions : undefined;
  };
  /** Moves the other drawing's square onto this one's. */
  const overlap = (s: ReturnType<typeof store>) =>
    s.getState().change("overlap", (draft) => {
      const copy = draft.geometry.find((shape) => shape.id === OTHER_SQUARE);
      if (copy) copy.paths = square.paths;
    });

  it("leaves the tabs of a profile on another drawing, even where they overlap", () => {
    const s = store();
    overlap(s);
    withProfile(s, [{ shapeId: OTHER_SQUARE, paths: null }], [[50, 0]]);
    setDrawingSize(s, DRAWING_ID, "width", 300);
    expect(tabsOf(s)).toEqual([[50, 0]]);
  });

  it("keeps a tab on an arc with its drawing over several resizes", () => {
    const s = store();
    const tab = nearestOnLoops(closedLoops([circle]), [70, 50])?.point;
    if (!tab) throw new Error("fixture");
    withProfile(s, [{ shapeId: CIRCLE_ID, paths: null }], [tab]);
    const from = anchorPoint(size(s).bounds, "bottom_left");
    setDrawingSize(s, DRAWING_ID, "width", size(s).width * 3);
    setDrawingSize(s, DRAWING_ID, "width", size(s).width * 3);
    const [moved] = tabsOf(s) ?? [];
    expect(moved?.[0]).toBeCloseTo(from[0] + (tab[0] - from[0]) * 9, 6);
    expect(moved?.[1]).toBeCloseTo(from[1] + (tab[1] - from[1]) * 9, 6);
  });

  it("keeps the tabs on a coincident shape of another drawing when one is removed", () => {
    const s = store();
    overlap(s);
    withProfile(
      s,
      [
        { shapeId: SQUARE_ID, paths: null },
        { shapeId: OTHER_SQUARE, paths: null },
      ],
      [[50, 0]],
    );
    removeDrawing(s, DRAWING_ID);
    expect(tabsOf(s)).toEqual([[50, 0]]);
  });

  it("moves with the tabs on its paths in one undo step, leaving the other drawing", () => {
    const s = store();
    const other = s.getState().document.geometry[2];
    const before = size(s).bounds;
    moveDrawing(s, DRAWING_ID, [12.5, -3]);
    const after = size(s).bounds;
    expect(after.min[0]).toBeCloseTo(before.min[0] + 12.5, 9);
    expect(after.min[1]).toBeCloseTo(before.min[1] - 3, 9);
    expect(tabsOf(s)).toEqual([[62.5, -3]]);
    expect(s.getState().document.geometry[2]).toBe(other);
    expect(s.getState().past).toHaveLength(1);
    moveDrawing(s, DRAWING_ID, [0, 0]);
    expect(s.getState().past).toHaveLength(1);
  });

  it("sets its anchor point's distance from the zero, one axis at a time", () => {
    const s = store();
    setDrawingOffset(s, DRAWING_ID, "x", 40);
    setDrawingOffset(s, DRAWING_ID, "y", -5);
    const { document } = s.getState();
    expect(drawingOffset(document.stock, size(s).bounds)).toEqual([40, -5]);
    // With the zero at the centre, the drawing's centre is measured from the stock's.
    setXYAnchor(s, "center");
    setDrawingOffset(s, DRAWING_ID, "x", 0);
    const { bounds } = size(s);
    expect((bounds.min[0] + bounds.max[0]) / 2).toBeCloseTo(150, 6);
  });

  it("mirrors in place, flipping arcs, with its tabs, in one undo step; twice restores it", () => {
    const s = store();
    const before = s.getState().document;
    const box = size(s).bounds;
    expect(mirrorDrawing(s, DRAWING_ID, "x")).toEqual({ ok: true });
    const { document } = s.getState();
    const after = size(s).bounds;
    expect(after.min[0]).toBeCloseTo(box.min[0], 6);
    expect(after.max[0]).toBeCloseTo(box.max[0], 6);
    const hole = document.geometry.find((shape) => shape.id === CIRCLE_ID);
    expect(hole?.paths[0]?.segments[0]).toMatchObject({ kind: "arc", clockwise: true });
    // The tab mirrors across the box's centre line, with its path.
    const centre = (box.min[0] + box.max[0]) / 2;
    expect(tabsOf(s)?.[0]?.[0]).toBeCloseTo(2 * centre - 50, 6);
    expect(s.getState().past).toHaveLength(1);
    expect(ProjectDocument.parse(document)).toEqual(document);
    mirrorDrawing(s, DRAWING_ID, "x");
    expect(size(s).bounds.min[0]).toBeCloseTo(box.min[0], 6);
    expect(s.getState().document.geometry[0]).toEqual(before.geometry[0]);
  });

  it("turns by 90° steps or any angle, keeping the anchor point in place", () => {
    const s = store();
    const corner = size(s).bounds.min;
    const { width, height } = size(s);
    rotateDrawing(s, DRAWING_ID, 90);
    expect(size(s).width).toBeCloseTo(height, 6);
    expect(size(s).height).toBeCloseTo(width, 6);
    expect(size(s).bounds.min[0]).toBeCloseTo(corner[0], 6);
    expect(size(s).bounds.min[1]).toBeCloseTo(corner[1], 6);
    rotateDrawing(s, DRAWING_ID, 33);
    expect(size(s).bounds.min[0]).toBeCloseTo(corner[0], 6);
    expect(size(s).bounds.min[1]).toBeCloseTo(corner[1], 6);
    expect(ProjectDocument.parse(s.getState().document)).toBeTruthy();
    expect(s.getState().past).toHaveLength(2);
    expect(rotateDrawing(s, DRAWING_ID, 360)).toEqual({ ok: true });
    expect(s.getState().past).toHaveLength(2);
  });

  it("counts the operations that only machine it", () => {
    const doc = store().getState().document;
    expect(drawingOperations(doc, DRAWING_ID).map((operation) => operation.id)).toEqual([
      doc.operations[0]?.id,
    ]);
    expect(drawingOperations(doc, "0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e")).toEqual([]);
  });
});

describe("text items", () => {
  /** A project with `textItem`, whose origin is its outline's first point. */
  function textStore() {
    const doc = fullDocument();
    return createDocumentStore({
      ...doc,
      drawings: [...doc.drawings, textItem],
      geometry: [...doc.geometry, textShape],
    });
  }

  /** The text item's settings, and its origin's point on its outline. */
  function text(document: ProjectDocument, id = TEXT_ID) {
    const settings = document.drawings.find((drawing) => drawing.id === id)?.text;
    const [shape] = drawingShapes(document.geometry, id);
    return { ...settings?.placement, height: settings?.height, origin: shape?.paths[0]?.start };
  }

  it("keep their placement on their outlines when moved, turned, mirrored and resized", () => {
    const store = textStore();
    moveDrawing(store, TEXT_ID, [5, 7]);
    expect(text(store.getState().document)).toMatchObject({ position: [15, 17], height: 10 });
    rotateDrawing(store, TEXT_ID, 90);
    mirrorDrawing(store, TEXT_ID, "x");
    expect(setDrawingSize(store, TEXT_ID, "height", 4)).toEqual({ ok: true });
    const { position, origin, ...rest } = text(store.getState().document);
    expect(position).toEqual(origin);
    expect(rest).toEqual({ rotation: 270, mirrored: true, height: 20 });
    store.getState().undo();
    expect(text(store.getState().document)).toMatchObject({ rotation: 270, height: 10 });
  });

  it("keep their placement on their outlines when duplicated or the design is aligned", () => {
    const store = textStore();
    const copyId = duplicateDrawing(store, TEXT_ID) as string;
    const copy = text(store.getState().document, copyId);
    expect(copy.position).toEqual(copy.origin);
    expect(copy.position).not.toEqual(textItem.text?.placement.position);
    const before = text(store.getState().document).position;
    setXYAnchor(store, "center");
    expect(text(store.getState().document).position).not.toEqual(before);
    for (const id of [TEXT_ID, copyId]) {
      const { position, origin } = text(store.getState().document, id);
      expect(position).toEqual(origin);
    }
  });
});

/** A closed `width` × 10 mm box with its bottom-left corner at `[x, y]`. */
function box(x: number, y: number, width: number): Path {
  return {
    start: [x, y],
    segments: [
      { kind: "line", to: [x + width, y] },
      { kind: "line", to: [x + width, y + 10] },
      { kind: "line", to: [x, y + 10] },
    ],
    closed: true,
  };
}

describe("addTextItem", () => {
  const settings: TextSettings = {
    text: "Hi",
    font: "jetbrains-mono",
    height: 10,
    align: "left",
    placement: { position: [0, 0], rotation: 0, mirrored: false },
  };

  it("places it like an imported drawing, its origin moving with its outlines, in one undo step", () => {
    const store = storeAt("bottom_left");
    const id = addTextItem(store, settings, [box(0, 0, 20)]);
    const { drawings, geometry } = store.getState().document;
    expect(drawings).toEqual([
      {
        id,
        name: "Hi",
        border: 10,
        text: { ...settings, placement: { ...settings.placement, position: [10, 10] } },
      },
    ]);
    expect(geometry).toMatchObject([{ drawingId: id, paths: [box(10, 10, 20)] }]);
    expect(() => ProjectDocument.parse(store.getState().document)).not.toThrow();
    store.getState().undo();
    expect(store.getState().document.drawings).toEqual([]);
  });

  it("adds nothing without outlines, or to a project with a model", () => {
    const store = storeAt("bottom_left");
    expect(addTextItem(store, settings, [])).toBeNull();
    store.setState({ document: { ...createProjectDocument(), models: [model] } });
    expect(addTextItem(store, settings, [box(0, 0, 20)])).toBeNull();
    expect(store.getState().document.drawings).toEqual([]);
  });
});

describe("setTextItem", () => {
  const OPERATION = "5b2c8e1a-7d4f-4a3b-9c6e-0f1a2b3c4d5e";

  /** `textItem`, cut by a profile on its path 0 with a tab on it, and the fixture's profile. */
  function store() {
    const doc = fullDocument();
    const [profile] = doc.operations;
    if (profile?.type !== "profile" || !profile.params.tabs) throw new Error("fixture");
    const onText = {
      ...profile,
      id: OPERATION,
      targets: [{ shapeId: textShape.id, paths: [0] }],
      params: {
        ...profile.params,
        tabs: { ...profile.params.tabs, positions: [[11, 10]] as Point[] },
      },
    };
    return createDocumentStore({
      ...doc,
      drawings: [...doc.drawings, textItem],
      geometry: [...doc.geometry, textShape],
      operations: [...doc.operations, onText],
    });
  }

  it("replaces its settings and outlines in one undo step, keeping its shape and operations", () => {
    const text = store();
    const before = text.getState().document;
    const settings = { ...(textItem.text as TextSettings), text: "II", height: 12 };
    const paths = [box(10, 10, 2), box(14, 10, 2)];
    expect(setTextItem(text, TEXT_ID, settings, paths)).toEqual({ ok: true });
    const after = text.getState().document;
    expect(after.drawings.at(-1)).toEqual({ ...textItem, name: "II", text: settings });
    expect(after.geometry.at(-1)).toEqual({ ...textShape, paths });
    const onText = after.operations.find(({ id }) => id === OPERATION);
    expect(onText?.targets).toEqual([{ shapeId: textShape.id, paths: null }]);
    expect(onText?.type === "profile" && onText.params.tabs?.positions).toEqual([]);
    // The other profile's targets and tabs aren't the text's.
    expect(after.operations[0]).toEqual(before.operations[0]);
    expect(() => ProjectDocument.parse(after)).not.toThrow();
    text.getState().undo();
    expect(text.getState().document).toEqual(before);
  });

  it("refuses text with no outlines, changing nothing", () => {
    const text = store();
    const before = text.getState().document;
    expect(setTextItem(text, TEXT_ID, textItem.text as TextSettings, [])).toEqual({
      ok: false,
      error: { code: "workspace.textNoOutlines" },
    });
    expect(text.getState().document).toBe(before);
  });
});
