import { createProjectDocument } from "@furrow/document";
import { describe, expect, it } from "vitest";
import { createDocumentStore } from "./document-store";
import {
  setCustomOrigin,
  setCustomXYOrigin,
  setStockDimension,
  setUnits,
  setXYAnchor,
  setZOrigin,
} from "./stock-actions";

/** 600 × 400 mm stock, zeroed at its bottom-left corner. */
function newStore() {
  return createDocumentStore(createProjectDocument());
}

const stock = (store: ReturnType<typeof newStore>) => store.getState().document.stock;

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

  it("adds no undo step for the current anchor", () => {
    const store = newStore();
    setXYAnchor(store, "bottom_left");
    expect(store.getState().past).toHaveLength(0);
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

describe("setZOrigin", () => {
  it("changes the Z zero as one undo step", () => {
    const store = newStore();
    setZOrigin(store, "machine_bed");
    expect(stock(store).zOrigin).toBe("machine_bed");
    setZOrigin(store, "machine_bed");
    expect(store.getState().past).toHaveLength(1);
  });
});
