import { touchOffOutsideStock, xyOriginPosition } from "@furrow/cam-core";
import { createProjectDocument, ProjectDocument, StockAnchor } from "@furrow/document";
import { fullDocument } from "@furrow/document/fixtures";
import { describe, expect, it } from "vitest";
import { createDocumentStore } from "./document-store";
import { drawingAnchor, expectClose } from "./drawing-test-utils";
import {
  addTouchOff,
  pickXYOrigin,
  removeTouchOff,
  setCustomOrigin,
  setCustomXYOrigin,
  setStockDimension,
  setTouchOffField,
  setUnits,
  setXYAnchor,
  setZOrigin,
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
  it("is added in the corner nearest the zero the design leaves free, and removed", () => {
    // The drawing store's square sits on the bottom-left corner.
    const store = drawingStore();
    addTouchOff(store);
    const pad = stock(store).touchOff;
    expect(pad?.diameter).toBe(15);
    expect(pad).not.toEqual({ x: 7.5, y: 7.5, diameter: 15 });
    // Adding again keeps it.
    const steps = store.getState().past.length;
    addTouchOff(store);
    expect(store.getState().past).toHaveLength(steps);
    removeTouchOff(store);
    expect(stock(store).touchOff).toBeNull();
    store.getState().undo();
    expect(stock(store).touchOff).toEqual(pad);
  });

  it("moves and resizes about its centre, refusing a pad wider than the stock", () => {
    const store = newStore();
    addTouchOff(store);
    expect(setTouchOffField(store, "x", 100)).toBe(true);
    expect(setTouchOffField(store, "y", 50)).toBe(true);
    expect(setTouchOffField(store, "diameter", 30)).toBe(true);
    expect(stock(store).touchOff).toEqual({ x: 100, y: 50, diameter: 30 });
    expect(setTouchOffField(store, "diameter", 401)).toBe(false);
    expect(setTouchOffField(store, "diameter", 0)).toBe(false);
    expect(stock(store).touchOff).toEqual({ x: 100, y: 50, diameter: 30 });
  });

  it("shrinks about its centre when the stock gets narrower than it, keeping the document valid", () => {
    const store = newStore();
    addTouchOff(store);
    setTouchOffField(store, "diameter", 30);
    const { x, y } = stock(store).touchOff ?? { x: 0, y: 0 };
    setStockDimension(store, "width", 20);
    expect(stock(store).touchOff).toEqual({ x, y, diameter: 20 });
    expect(ProjectDocument.safeParse(store.getState().document).success).toBe(true);
    // Wider again, it stays as it is.
    setStockDimension(store, "width", 600);
    expect(stock(store).touchOff?.diameter).toBe(20);
  });

  it("follows a top-left zero when the stock is resized, as one undo step", () => {
    const store = newStore();
    setXYAnchor(store, "top_left");
    addTouchOff(store);
    expect(stock(store).touchOff).toEqual({ x: 7.5, y: 392.5, diameter: 15 });
    const steps = store.getState().past.length;
    setStockDimension(store, "height", 300);
    expect(stock(store).touchOff).toEqual({ x: 7.5, y: 292.5, diameter: 15 });
    expect(store.getState().past).toHaveLength(steps + 1);
    store.getState().undo();
    expect(stock(store).touchOff).toEqual({ x: 7.5, y: 392.5, diameter: 15 });
  });

  it("stays on the stock when a resize would push it off", () => {
    // A centre zero moves the drawing, and the pad, by half the change.
    const store = newStore();
    setXYAnchor(store, "center");
    addTouchOff(store);
    expect(stock(store).touchOff).toEqual({ x: 7.5, y: 7.5, diameter: 15 });
    setStockDimension(store, "width", 400);
    setStockDimension(store, "height", 100);
    expect(stock(store).touchOff).toEqual({ x: 7.5, y: 7.5, diameter: 15 });
    // Narrower than the pad: it shrinks and stays on the stock.
    setStockDimension(store, "height", 10);
    const pad = stock(store).touchOff;
    expect(pad).toEqual({ x: 7.5, y: 5, diameter: 10 });
    expect(pad && touchOffOutsideStock(stock(store), pad)).toBe(false);
  });

  it("is only kept on the stock when it was on it", () => {
    const store = newStore();
    addTouchOff(store);
    setTouchOffField(store, "x", 0);
    setStockDimension(store, "height", 300);
    expect(stock(store).touchOff).toEqual({ x: 0, y: 7.5, diameter: 15 });
  });

  it("moves with the design when the XY anchor changes", () => {
    const store = drawingStore();
    setXYAnchor(store, "center");
    addTouchOff(store);
    const before = store.getState().document;
    setXYAnchor(store, "top_right");
    const after = store.getState().document;
    const { drawing } = moved(before, after);
    const pad = (document: ProjectDocument) => {
      const { x, y } = document.stock.touchOff ?? { x: 0, y: 0 };
      return [x, y];
    };
    const padBefore = pad(before);
    expectClose(pad(after), [
      (padBefore[0] ?? 0) + (drawing[0] ?? 0),
      (padBefore[1] ?? 0) + (drawing[1] ?? 0),
    ]);
    expect(
      touchOffOutsideStock(after.stock, after.stock.touchOff ?? { x: 0, y: 0, diameter: 0 }),
    ).toBe(false);
  });

  it("is clamped, not moved, under a custom zero", () => {
    const store = newStore();
    addTouchOff(store);
    pickXYOrigin(store, [50, 50]);
    setStockDimension(store, "width", 400);
    expect(stock(store).touchOff).toEqual({ x: 7.5, y: 7.5, diameter: 15 });
    setTouchOffField(store, "x", 392.5);
    setStockDimension(store, "width", 300);
    expect(stock(store).touchOff).toEqual({ x: 292.5, y: 7.5, diameter: 15 });
  });

  it("can't be edited when there is none", () => {
    const store = newStore();
    expect(setTouchOffField(store, "x", 100)).toBe(false);
    expect(stock(store).touchOff).toBeNull();
  });
});
