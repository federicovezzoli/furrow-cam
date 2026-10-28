import { touchOffOutsideStock, xyOriginPosition } from "@furrow/cam-core";
import { createProjectDocument, ProjectDocument, StockAnchor } from "@furrow/document";
import { fullDocument, model } from "@furrow/document/fixtures";
import { describe, expect, it } from "vitest";
import { createDocumentStore } from "./document-store";
import { drawingAnchor, expectClose } from "./drawing-test-utils";
import {
  addTouchOff,
  pickXYOrigin,
  removeTouchOff,
  setCustomOrigin,
  setCustomXYOrigin,
  setFlipAxis,
  setLocatingPins,
  setPartingDepth,
  setStockDimension,
  setTouchOffField,
  setTouchOffToolChange,
  setTwoSided,
  setUnits,
  setXYAnchor,
  setZOrigin,
  updateLocatingPins,
} from "./stock-actions";

/** 600 × 400 mm stock, zeroed at its bottom-left corner. */
function newStore() {
  return createDocumentStore(createProjectDocument());
}

const stock = (store: ReturnType<typeof newStore>) => store.getState().document.stock;

/** 300 × 200 mm stock zeroed at its bottom-left corner, with a square, a hole and a tab. */
function drawingStore() {
  const document = fullDocument();
  document.stock.xyOrigin = { anchor: "bottom_left" };
  return createDocumentStore(document);
}

/**
 * A centre zero with the drawing at the stock's bottom-left corner, as in a
 * project saved before drawings were aligned (ADR-0022).
 */
function unalignedStore() {
  const document = fullDocument();
  document.stock.xyOrigin = { anchor: "center" };
  return createDocumentStore(document);
}

/** How far the drawing (the square's first point) and the first tab are from where they were. */
function moved(before: ProjectDocument, after: ProjectDocument) {
  const first = (document: ProjectDocument) => document.geometry[0]?.paths[0]?.start ?? [0, 0];
  const tab = (document: ProjectDocument) => {
    const operation = document.operations[0];
    return (operation?.type === "profile" && operation.params.tabs?.positions[0]) || [0, 0];
  };
  const delta = (a: number[], b: number[]) => [
    (b[0] ?? 0) - (a[0] ?? 0),
    (b[1] ?? 0) - (a[1] ?? 0),
  ];
  return { drawing: delta(first(before), first(after)), tab: delta(tab(before), tab(after)) };
}

describe("setUnits", () => {
  it("changes the display units as one undo step", () => {
    const store = newStore();
    setUnits(store, "in");
    expect(store.getState().document.units).toBe("in");
    setUnits(store, "in");
    expect(store.getState().past).toHaveLength(1);
  });
});

describe("setStockDimension", () => {
  it("keeps the parting plane inside a stock made thinner than it allows", () => {
    // 18 mm thick, parting 9 mm below the top.
    const store = createDocumentStore(fullDocument());
    setStockDimension(store, "thickness", 12);
    expect(stock(store).twoSided?.partingDepth).toBe(9);
    setStockDimension(store, "thickness", 6);
    expect(stock(store).twoSided?.partingDepth).toBe(4.5);
    expect(ProjectDocument.safeParse(store.getState().document).success).toBe(true);
    store.getState().undo();
    expect(stock(store).twoSided?.partingDepth).toBe(9);
  });

  it("resizes one dimension as one undo step", () => {
    const store = newStore();
    setStockDimension(store, "thickness", 12);
    expect(stock(store)).toMatchObject({ width: 600, height: 400, thickness: 12 });
    setStockDimension(store, "thickness", 12);
    expect(store.getState().past).toHaveLength(1);
    store.getState().undo();
    expect(stock(store).thickness).toBe(18);
  });

  it("keeps an anchored zero on its anchor", () => {
    const store = newStore();
    setXYAnchor(store, "top_right");
    setStockDimension(store, "width", 500);
    expect(stock(store).xyOrigin).toEqual({ anchor: "top_right" });
  });

  it.each(StockAnchor.options)("keeps the drawing aligned to a %s zero", (anchor) => {
    const store = drawingStore();
    setXYAnchor(store, anchor === "center" ? "bottom_left" : "center");
    setXYAnchor(store, anchor);
    const before = store.getState().document;
    setStockDimension(store, "width", 400);
    setStockDimension(store, "height", 300);
    const after = store.getState().document;
    expectClose(drawingAnchor(after, anchor), xyOriginPosition(after.stock));
    const { drawing, tab } = moved(before, after);
    expectClose(tab, drawing);
    store.getState().undo();
    store.getState().undo();
    expect(store.getState().document).toEqual(before);
  });

  it("moves a drawing that isn't aligned with the zero, without aligning it", () => {
    const store = unalignedStore();
    const before = store.getState().document;
    setStockDimension(store, "thickness", 12);
    expect(store.getState().document.geometry).toBe(before.geometry);
    setStockDimension(store, "width", 400);
    const { drawing, tab } = moved(before, store.getState().document);
    expect(drawing).toEqual([50, 0]);
    expect(tab).toEqual([50, 0]);
  });

  it("leaves the drawing in place under a custom zero, or for a new thickness", () => {
    const store = drawingStore();
    setXYAnchor(store, "center");
    const { geometry, operations } = store.getState().document;
    setStockDimension(store, "thickness", 12);
    pickXYOrigin(store, [50, 50]);
    setStockDimension(store, "width", 400);
    expect(store.getState().document.geometry).toBe(geometry);
    expect(store.getState().document.operations).toBe(operations);
    expect(stock(store).xyOrigin).toEqual({ anchor: "custom", x: 50, y: 50 });
  });
});

describe("setXYAnchor", () => {
  it("puts the zero on the anchor as one undo step", () => {
    const store = newStore();
    setXYAnchor(store, "top_right");
    expect(stock(store).xyOrigin).toEqual({ anchor: "top_right" });
    expect(store.getState().past).toHaveLength(1);
    store.getState().undo();
    expect(stock(store).xyOrigin).toEqual({ anchor: "bottom_left" });
  });

  it("adds no undo step for the current anchor when the drawing is aligned", () => {
    const store = newStore();
    setXYAnchor(store, "bottom_left");
    expect(store.getState().past).toHaveLength(0);
    const drawing = drawingStore();
    setXYAnchor(drawing, "center");
    setXYAnchor(drawing, "center");
    expect(drawing.getState().past).toHaveLength(1);
  });

  it("aligns a drawing that isn't when the current anchor is chosen", () => {
    const store = unalignedStore();
    setXYAnchor(store, "center");
    expectClose(drawingAnchor(store.getState().document, "center"), [150, 100]);
    expect(store.getState().past).toHaveLength(1);
  });

  it.each(StockAnchor.options)("aligns the drawing to the stock at %s", (anchor) => {
    const store = drawingStore();
    setXYAnchor(store, "center");
    const before = store.getState().document;
    setXYAnchor(store, anchor);
    const after = store.getState().document;
    expectClose(drawingAnchor(after, anchor), xyOriginPosition(after.stock));
    const { drawing, tab } = moved(before, after);
    expectClose(tab, drawing);
    if (anchor === "center") {
      expect(after).toBe(before);
      return;
    }
    expect(store.getState().past).toHaveLength(2);
    store.getState().undo();
    expect(store.getState().document).toEqual(before);
  });

  it("puts the drawing's bottom-left corner on the stock's", () => {
    const store = drawingStore();
    setXYAnchor(store, "center");
    setXYAnchor(store, "bottom_left");
    expectClose(drawingAnchor(store.getState().document, "bottom_left"), [0, 0]);
  });

  it("re-aligns the drawing when leaving a custom zero", () => {
    const store = drawingStore();
    setXYAnchor(store, "top_right");
    pickXYOrigin(store, [50, 50]);
    setXYAnchor(store, "center");
    const after = store.getState().document;
    expectClose(drawingAnchor(after, "center"), [150, 100]);
  });
});

describe("setCustomXYOrigin", () => {
  it("starts where the anchor is, so the zero doesn't move", () => {
    const store = newStore();
    setXYAnchor(store, "top_center");
    setCustomXYOrigin(store);
    expect(stock(store).xyOrigin).toEqual({ anchor: "custom", x: 300, y: 400 });
    expect(store.getState().past).toHaveLength(2);
  });

  it("keeps an existing custom zero", () => {
    const store = newStore();
    setCustomXYOrigin(store);
    setCustomOrigin(store, "x", 12);
    setCustomXYOrigin(store);
    expect(stock(store).xyOrigin).toEqual({ anchor: "custom", x: 12, y: 0 });
    expect(store.getState().past).toHaveLength(2);
  });
});

describe("setCustomOrigin", () => {
  it("moves one axis as one undo step, outside the stock too", () => {
    const store = newStore();
    setCustomXYOrigin(store);
    setCustomOrigin(store, "y", -25);
    expect(stock(store).xyOrigin).toEqual({ anchor: "custom", x: 0, y: -25 });
    store.getState().undo();
    expect(stock(store).xyOrigin).toEqual({ anchor: "custom", x: 0, y: 0 });
  });

  it("does nothing on an anchor or without a change", () => {
    const store = newStore();
    setCustomOrigin(store, "x", 10);
    expect(stock(store).xyOrigin).toEqual({ anchor: "bottom_left" });
    setCustomXYOrigin(store);
    setCustomOrigin(store, "x", 0);
    expect(store.getState().past).toHaveLength(1);
  });

  it("makes a gesture's changes one undo step", () => {
    const store = newStore();
    setCustomXYOrigin(store);
    store.getState().beginTransaction();
    for (const x of [1, 2, 3]) setCustomOrigin(store, "x", x);
    store.getState().commitTransaction();
    expect(store.getState().past).toHaveLength(2);
    store.getState().undo();
    expect(stock(store).xyOrigin).toEqual({ anchor: "custom", x: 0, y: 0 });
  });
});

describe("pickXYOrigin", () => {
  it("puts a custom zero on the picked point as one undo step", () => {
    const store = newStore();
    setXYAnchor(store, "center");
    pickXYOrigin(store, [12.5, -3]);
    expect(stock(store).xyOrigin).toEqual({ anchor: "custom", x: 12.5, y: -3 });
    expect(store.getState().past).toHaveLength(2);
    store.getState().undo();
    expect(stock(store).xyOrigin).toEqual({ anchor: "center" });
  });

  it("keeps the drawing where it is on the stock", () => {
    const store = drawingStore();
    setXYAnchor(store, "center");
    const { geometry, operations } = store.getState().document;
    setCustomXYOrigin(store);
    pickXYOrigin(store, [200, 150]);
    setCustomOrigin(store, "x", 210);
    expect(store.getState().document.geometry).toBe(geometry);
    expect(store.getState().document.operations).toBe(operations);
  });

  it("moves an existing custom zero, and adds no undo step for the same point", () => {
    const store = newStore();
    pickXYOrigin(store, [10, 20]);
    pickXYOrigin(store, [30, 40]);
    expect(stock(store).xyOrigin).toEqual({ anchor: "custom", x: 30, y: 40 });
    pickXYOrigin(store, [30, 40]);
    expect(store.getState().past).toHaveLength(2);
  });
});

describe("setZOrigin", () => {
  it("changes the Z zero as one undo step", () => {
    const store = newStore();
    setZOrigin(store, "machine_bed");
    expect(stock(store).zOrigin).toBe("machine_bed");
    setZOrigin(store, "machine_bed");
    expect(store.getState().past).toHaveLength(1);
  });
});

describe("touch-off pad", () => {
  /** A pad with the machine's tool change. */
  const pad = (x: number, y: number, diameter = 15) => ({ x, y, diameter, toolChange: null });

  it("is added centred on the XY zero, and removed", () => {
    // Imports add none (ADR-0043): the user ticks it.
    const store = newStore();
    setXYAnchor(store, "center");
    addTouchOff(store);
    expect(stock(store).touchOff).toEqual(pad(300, 200));
    // Adding again keeps it.
    const steps = store.getState().past.length;
    addTouchOff(store);
    expect(store.getState().past).toHaveLength(steps);
    removeTouchOff(store);
    expect(stock(store).touchOff).toBeNull();
    store.getState().undo();
    expect(stock(store).touchOff).toEqual(pad(300, 200));
  });

  it("moves and resizes about its centre, refusing a pad wider than the stock", () => {
    const store = newStore();
    addTouchOff(store);
    expect(setTouchOffField(store, "x", 100)).toBe(true);
    expect(setTouchOffField(store, "y", 50)).toBe(true);
    expect(setTouchOffField(store, "diameter", 30)).toBe(true);
    expect(stock(store).touchOff).toEqual(pad(100, 50, 30));
    expect(setTouchOffField(store, "diameter", 401)).toBe(false);
    expect(setTouchOffField(store, "diameter", 0)).toBe(false);
    expect(stock(store).touchOff).toEqual(pad(100, 50, 30));
  });

  it("takes its own tool change, blank text going back to the machine's", () => {
    const store = newStore();
    setTouchOffToolChange(store, "M0");
    expect(stock(store).touchOff).toBeNull();
    addTouchOff(store);
    setTouchOffToolChange(store, "G0 X{padX} Y{padY}\nM0");
    expect(stock(store).touchOff?.toolChange).toBe("G0 X{padX} Y{padY}\nM0");
    const steps = store.getState().past.length;
    setTouchOffToolChange(store, "  \n");
    expect(stock(store).touchOff?.toolChange).toBeNull();
    setTouchOffToolChange(store, null);
    expect(store.getState().past).toHaveLength(steps + 1);
    expect(ProjectDocument.safeParse(store.getState().document).success).toBe(true);
  });

  it("shrinks about its centre when the stock gets narrower than it, keeping the document valid", () => {
    const store = newStore();
    addTouchOff(store);
    setTouchOffField(store, "diameter", 30);
    setStockDimension(store, "width", 20);
    expect(stock(store).touchOff).toEqual(pad(0, 0, 20));
    expect(ProjectDocument.safeParse(store.getState().document).success).toBe(true);
    // Wider again, it stays as it is.
    setStockDimension(store, "width", 600);
    expect(stock(store).touchOff?.diameter).toBe(20);
  });

  it("follows an anchored zero when the stock is resized, as one undo step", () => {
    const store = newStore();
    setXYAnchor(store, "top_left");
    addTouchOff(store);
    expect(stock(store).touchOff).toEqual(pad(0, 400));
    const steps = store.getState().past.length;
    setStockDimension(store, "height", 300);
    expect(stock(store).touchOff).toEqual(pad(0, 300));
    expect(store.getState().past).toHaveLength(steps + 1);
    store.getState().undo();
    expect(stock(store).touchOff).toEqual(pad(0, 400));
  });

  it("stays on the stock when a resize would push it off", () => {
    // A centre zero moves the drawing, and the pad, by half the change.
    const store = newStore();
    setXYAnchor(store, "center");
    addTouchOff(store);
    setTouchOffField(store, "x", 7.5);
    setTouchOffField(store, "y", 7.5);
    setStockDimension(store, "width", 400);
    setStockDimension(store, "height", 100);
    expect(stock(store).touchOff).toEqual(pad(7.5, 7.5));
    // Narrower than the pad: it shrinks and stays on the stock.
    setStockDimension(store, "height", 10);
    const shrunk = stock(store).touchOff;
    expect(shrunk).toEqual(pad(7.5, 5, 10));
    expect(shrunk && touchOffOutsideStock(stock(store), shrunk)).toBe(false);
  });

  it("is only kept on the stock when it was on it", () => {
    // Centred on a bottom-left zero, three quarters of it are off the stock.
    const store = newStore();
    setXYAnchor(store, "top_left");
    addTouchOff(store);
    setStockDimension(store, "height", 300);
    expect(stock(store).touchOff).toEqual(pad(0, 300));
  });

  it("moves with the design when the XY anchor changes", () => {
    const store = drawingStore();
    setXYAnchor(store, "center");
    addTouchOff(store);
    const before = store.getState().document;
    setXYAnchor(store, "top_right");
    const after = store.getState().document;
    const { drawing } = moved(before, after);
    const at = (document: ProjectDocument) => {
      const { x, y } = document.stock.touchOff ?? { x: 0, y: 0 };
      return [x, y];
    };
    const [x, y] = at(before);
    expectClose(at(after), [(x ?? 0) + (drawing[0] ?? 0), (y ?? 0) + (drawing[1] ?? 0)]);
  });

  it("is clamped, not moved, under a custom zero", () => {
    const store = newStore();
    addTouchOff(store);
    setTouchOffField(store, "x", 7.5);
    setTouchOffField(store, "y", 7.5);
    pickXYOrigin(store, [50, 50]);
    setStockDimension(store, "width", 400);
    expect(stock(store).touchOff).toEqual(pad(7.5, 7.5));
    setTouchOffField(store, "x", 392.5);
    setStockDimension(store, "width", 300);
    expect(stock(store).touchOff).toEqual(pad(292.5, 7.5));
  });

  it("can't be edited when there is none", () => {
    const store = newStore();
    expect(setTouchOffField(store, "x", 100)).toBe(false);
    expect(stock(store).touchOff).toBeNull();
  });
});

describe("two-sided projects (ADR-0060)", () => {
  it("part at half the stock's thickness without a model, flipped about X", () => {
    const store = newStore();
    setTwoSided(store, true);
    expect(stock(store).twoSided).toEqual({ flipAxis: "x", partingDepth: 9, pins: null });
    setFlipAxis(store, "y");
    setPartingDepth(store, 6);
    expect(stock(store).twoSided).toEqual({ flipAxis: "y", partingDepth: 6, pins: null });
    // Outside the stock: refused.
    for (const depth of [0, 18, 20]) setPartingDepth(store, depth);
    expect(stock(store).twoSided?.partingDepth).toBe(6);
  });

  it("part at half the deepest model's depth, within the stock", () => {
    const document = createProjectDocument();
    const deep = { ...model, placement: { ...model.placement, depth: 12 } };
    const store = createDocumentStore({ ...document, models: [model, deep] });
    setTwoSided(store, true);
    expect(stock(store).twoSided?.partingDepth).toBe(6);

    const deeper = { ...model, placement: { ...model.placement, depth: 40 } };
    const thin = createDocumentStore({ ...document, models: [deeper] });
    setTwoSided(thin, true);
    expect(thin.getState().document.stock.twoSided?.partingDepth).toBe(9);
    // A shallow model's half depth is below the field's least: clamped to it.
    const shallow = { ...model, placement: { ...model.placement, depth: 0.1 } };
    const flat = createDocumentStore({ ...document, models: [shallow] });
    setTwoSided(flat, true);
    expect(flat.getState().document.stock.twoSided?.partingDepth).toBe(0.1);
  });

  it("move the bottom side's operations to the top when turned off, in one undo step", () => {
    const document = fullDocument();
    const operations = document.operations.map((op) => ({ ...op, stockSide: "bottom" as const }));
    const store = createDocumentStore({ ...document, operations });
    setTwoSided(store, false);
    const after = store.getState().document;
    expect(after.stock.twoSided).toBeNull();
    expect(after.operations.every((op) => op.stockSide === "top")).toBe(true);
    expect(ProjectDocument.safeParse(after).success).toBe(true);
    store.getState().undo();
    expect(store.getState().document).toEqual({ ...document, operations });
  });

  it("add a symmetric pair of locating pins, and take valid changes to them only", () => {
    const store = newStore();
    setLocatingPins(store, true);
    expect(stock(store).twoSided).toBeNull();
    setTwoSided(store, true);
    setLocatingPins(store, true);
    // 600 mm along X: two fifths of it either side of the centre.
    expect(stock(store).twoSided?.pins).toEqual({
      diameter: 6,
      positions: [-240, 240],
      holes: { type: "through", spoilboardDepth: 5 },
    });
    expect(updateLocatingPins(store, { holes: { type: "blind", depth: 8 } })).toBe(true);
    expect(updateLocatingPins(store, { positions: [0] })).toBe(false);
    expect(updateLocatingPins(store, { diameter: 0 })).toBe(false);
    expect(stock(store).twoSided?.pins).toMatchObject({
      diameter: 6,
      positions: [-240, 240],
      holes: { type: "blind", depth: 8 },
    });
    expect(ProjectDocument.safeParse(store.getState().document).success).toBe(true);
    // Blind holes stay inside the stock, also when it gets thinner.
    expect(updateLocatingPins(store, { holes: { type: "blind", depth: 18 } })).toBe(false);
    expect(updateLocatingPins(store, { holes: { type: "blind", depth: 15 } })).toBe(true);
    setStockDimension(store, "thickness", 10);
    expect(stock(store).twoSided?.pins?.holes).toEqual({ type: "blind", depth: 15 * (10 / 18) });
    expect(ProjectDocument.safeParse(store.getState().document).success).toBe(true);
    setLocatingPins(store, false);
    expect(stock(store).twoSided?.pins).toBeNull();
  });
});
