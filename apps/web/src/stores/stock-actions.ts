import { xyOriginPosition } from "@furrow/cam-core";
import type { Point, StockAnchor, Units, ZOrigin } from "@furrow/document";
import type { DocumentStore } from "./document-store";

/**
 * Document store actions on the project's units and stock (ADR-0010): each
 * change is one undo step, or part of the open transaction. A change that
 * leaves the document as it was adds no undo step (`change` skips it).
 */

export type StockDimension = "width" | "height" | "thickness";

export function setUnits(store: DocumentStore, units: Units) {
  store.getState().change("setUnits", (draft) => {
    draft.units = units;
  });
}

/** Resizes the stock along one dimension, in millimetres. */
export function setStockDimension(store: DocumentStore, dimension: StockDimension, value: number) {
  store.getState().change(`setStock.${dimension}`, (draft) => {
    draft.stock[dimension] = value;
  });
}

/** Puts the XY zero on a stock anchor (ADR-0016). */
export function setXYAnchor(store: DocumentStore, anchor: StockAnchor) {
  // Checked here: assigning a new object would be a change even for the same anchor.
  if (store.getState().document.stock.xyOrigin.anchor === anchor) return;
  store.getState().change("setStock.xyOrigin", (draft) => {
    draft.stock.xyOrigin = { anchor };
  });
}

/**
 * Switches the XY zero to a custom point where the zero is now, so it doesn't
 * jump; the user then moves it with `setCustomOrigin`.
 */
export function setCustomXYOrigin(store: DocumentStore) {
  const { stock } = store.getState().document;
  if (stock.xyOrigin.anchor === "custom") return;
  const [x, y] = xyOriginPosition(stock);
  store.getState().change("setStock.xyOrigin", (draft) => {
    draft.stock.xyOrigin = { anchor: "custom", x, y };
  });
}

/** Moves a custom XY zero along one axis, in millimetres from the stock's bottom-left corner. */
export function setCustomOrigin(store: DocumentStore, axis: "x" | "y", value: number) {
  store.getState().change(`setStock.xyOrigin.${axis}`, (draft) => {
    if (draft.stock.xyOrigin.anchor === "custom") draft.stock.xyOrigin[axis] = value;
  });
}

/**
 * Puts the XY zero on a custom point picked in the viewport, in stock
 * coordinates, as one undo step. The point is fixed: it doesn't follow the
 * shape it was picked on (PRD-0002).
 */
export function pickXYOrigin(store: DocumentStore, [x, y]: Point) {
  store.getState().change("setStock.xyOrigin", (draft) => {
    const origin = draft.stock.xyOrigin;
    // Assigned field by field, so picking the zero where it is changes nothing.
    if (origin.anchor === "custom") {
      origin.x = x;
      origin.y = y;
    } else draft.stock.xyOrigin = { anchor: "custom", x, y };
  });
}

export function setZOrigin(store: DocumentStore, zOrigin: ZOrigin) {
  store.getState().change("setStock.zOrigin", (draft) => {
    draft.stock.zOrigin = zOrigin;
  });
}
