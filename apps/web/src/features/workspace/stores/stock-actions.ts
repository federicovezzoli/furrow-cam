import {
  designAlignment,
  translatePoint,
  translateShapes,
  xyOriginPosition,
  xyOriginShift,
} from "@furrow/cam-core";
import type { Point, ProjectDocument, StockAnchor, Units, ZOrigin } from "@furrow/document";
import type { Draft } from "immer";
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

/**
 * Moves the design on the stock by `offset`: its shapes, the models placed
 * with them (ADR-0031) and everything else stored in stock coordinates with
 * them, the profiles' tab positions. `geometry` is the document's, read
 * outside the draft: reading every point through it would be slow.
 */
function moveDrawing(
  draft: Draft<ProjectDocument>,
  geometry: ProjectDocument["geometry"],
  offset: Point,
) {
  if (offset[0] === 0 && offset[1] === 0) return;
  // One assignment, so the undo step is one patch rather than one per point.
  draft.geometry = translateShapes(geometry, offset);
  for (const { placement } of draft.models) {
    placement.position = translatePoint(placement.position, offset);
  }
  for (const operation of draft.operations) {
    if (operation.type !== "profile" || !operation.params.tabs) continue;
    const { tabs } = operation.params;
    tabs.positions = tabs.positions.map((position) => translatePoint(position, offset));
  }
}

/**
 * Resizes the stock along one dimension, in millimetres. An anchored zero
 * follows the stock and the drawing moves with it (ADR-0022), so a drawing
 * aligned to the anchor stays aligned; a custom zero and the drawing stay
 * where they are.
 */
export function setStockDimension(store: DocumentStore, dimension: StockDimension, value: number) {
  const { stock, geometry } = store.getState().document;
  const offset = xyOriginShift(stock, { ...stock, [dimension]: value });
  store.getState().change(`setStock.${dimension}`, (draft) => {
    draft.stock[dimension] = value;
    moveDrawing(draft, geometry, offset);
  });
}

/**
 * Puts the XY zero on a stock anchor (ADR-0016) and aligns the design, the
 * drawing and the models together, to the stock at the same anchor (ADR-0022,
 * ADR-0031), so the zero is that point of the design too. Choosing the
 * current anchor aligns a design that isn't.
 */
export function setXYAnchor(store: DocumentStore, anchor: StockAnchor) {
  const { stock, geometry, models } = store.getState().document;
  const offset = designAlignment(stock, geometry, models, anchor);
  store.getState().change("setStock.xyOrigin", (draft) => {
    // Checked: assigning a new object would be a change even for the same anchor.
    if (draft.stock.xyOrigin.anchor !== anchor) draft.stock.xyOrigin = { anchor };
    moveDrawing(draft, geometry, offset);
  });
}

/**
 * Switches the XY zero to a custom point where the zero is now, so it doesn't
 * jump; the user then moves it with `setCustomOrigin`. A custom zero moves on
 * the stock and the drawing stays where it is (PRD-0002 Z4–Z6).
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
