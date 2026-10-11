import { xyOriginPosition } from "@furrow/cam-core";
import type { StockAnchor, ZOrigin } from "@furrow/document";
import type { DocumentStore } from "./document-store";

/**
 * Document store actions on the stock's zero point (ADR-0010, ADR-0016,
 * PRD-0002): each change is one undo step, or part of the open transaction.
 */

/** Puts the XY zero on a stock anchor. */
export function setXYAnchor(store: DocumentStore, anchor: StockAnchor) {
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
  const origin = store.getState().document.stock.xyOrigin;
  if (origin.anchor !== "custom" || origin[axis] === value) return;
  store.getState().change(`setStock.xyOrigin.${axis}`, (draft) => {
    if (draft.stock.xyOrigin.anchor === "custom") draft.stock.xyOrigin[axis] = value;
  });
}

export function setZOrigin(store: DocumentStore, zOrigin: ZOrigin) {
  if (store.getState().document.stock.zOrigin === zOrigin) return;
  store.getState().change("setStock.zOrigin", (draft) => {
    draft.stock.zOrigin = zOrigin;
  });
}
