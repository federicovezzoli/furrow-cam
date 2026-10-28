import {
  clampTouchOff,
  defaultTouchOff,
  designAlignment,
  touchOffOutsideStock,
  translatePoint,
  translateShapes,
  xyOriginPosition,
  xyOriginShift,
} from "@furrow/cam-core";
import {
  type FlipAxis,
  LocatingPins,
  type Point,
  type ProjectDocument,
  type StockAnchor,
  type TouchOffDisc,
  type Units,
  type ZOrigin,
} from "@furrow/document";
import type { Draft } from "immer";
import type { DocumentStore } from "./document-store";
import { moveTextWithOutlines } from "./geometry-actions";

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
 * Moves the design on the stock by `offset`: its shapes, the text items'
 * placements (ADR-0059), the models placed with them (ADR-0031) and
 * everything else stored in stock coordinates with them, the profiles' tab
 * positions and the touch-off pad (ADR-0043), which was placed on the zero
 * the design follows. `geometry` is the document's,
 * read outside the draft: reading every point through it would be slow.
 */
function moveDrawing(
  draft: Draft<ProjectDocument>,
  geometry: ProjectDocument["geometry"],
  offset: Point,
) {
  if (offset[0] === 0 && offset[1] === 0) return;
  // One assignment, so the undo step is one patch rather than one per point.
  draft.geometry = translateShapes(geometry, offset);
  for (const drawing of draft.drawings) {
    moveTextWithOutlines(drawing, (point) => translatePoint(point, offset));
  }
  for (const { placement } of draft.models) {
    placement.position = translatePoint(placement.position, offset);
  }
  for (const operation of draft.operations) {
    if (operation.type !== "profile" || !operation.params.tabs) continue;
    const { tabs } = operation.params;
    tabs.positions = tabs.positions.map((position) => translatePoint(position, offset));
  }
  const pad = draft.stock.touchOff;
  if (pad) [pad.x, pad.y] = translatePoint([pad.x, pad.y], offset);
}

/**
 * Brings the touch-off pad back onto the stock after a change moved it or
 * resized the stock, if it was wholly on the stock `before`: one the user
 * put partly off stays where it is.
 */
function keepTouchOffOnStock(draft: Draft<ProjectDocument>, before: ProjectDocument["stock"]) {
  const pad = draft.stock.touchOff;
  if (!pad || !before.touchOff || touchOffOutsideStock(before, before.touchOff)) return;
  const { x, y } = clampTouchOff(draft.stock, pad);
  // Assigned only when moved, so a pad on the stock adds nothing to the step.
  if (x !== pad.x) pad.x = x;
  if (y !== pad.y) pad.y = y;
}

/**
 * Resizes the stock along one dimension, in millimetres. An anchored zero
 * follows the stock and the drawing moves with it (ADR-0022), so a drawing
 * aligned to the anchor stays aligned; a custom zero and the drawing stay
 * where they are. The touch-off pad moves with the drawing and stays on the
 * stock (ADR-0041), and the parting plane in it (ADR-0060).
 */
export function setStockDimension(store: DocumentStore, dimension: StockDimension, value: number) {
  const { stock, geometry } = store.getState().document;
  const offset = xyOriginShift(stock, { ...stock, [dimension]: value });
  store.getState().change(`setStock.${dimension}`, (draft) => {
    draft.stock[dimension] = value;
    moveDrawing(draft, geometry, offset);
    // The pad must fit on the stock (ADR-0041): it shrinks about its centre.
    const pad = draft.stock.touchOff;
    const widest = Math.min(draft.stock.width, draft.stock.height);
    if (pad && pad.diameter > widest) pad.diameter = widest;
    keepTouchOffOnStock(draft, stock);
    // The parting plane must lie inside the stock (ADR-0060): a thinner stock
    // than it allows keeps it at the same fraction of the thickness.
    const twoSided = draft.stock.twoSided;
    if (twoSided && twoSided.partingDepth >= draft.stock.thickness) {
      twoSided.partingDepth = (twoSided.partingDepth * draft.stock.thickness) / stock.thickness;
    }
    // So must blind pin holes, kept the same way.
    const holes = twoSided?.pins?.holes;
    if (holes?.type === "blind" && holes.depth >= draft.stock.thickness) {
      holes.depth = (holes.depth * draft.stock.thickness) / stock.thickness;
    }
  });
}

/**
 * Puts the XY zero on a stock anchor (ADR-0016) and aligns the design, the
 * drawing and the models together, to the stock at the same anchor (ADR-0022,
 * ADR-0031), so the zero is that point of the design too. Choosing the
 * current anchor aligns a design that isn't. The touch-off pad moves with the
 * design and stays on the stock (ADR-0041).
 */
export function setXYAnchor(store: DocumentStore, anchor: StockAnchor) {
  const { stock, geometry, models } = store.getState().document;
  const offset = designAlignment(stock, geometry, models, anchor);
  store.getState().change("setStock.xyOrigin", (draft) => {
    // Checked: assigning a new object would be a change even for the same anchor.
    if (draft.stock.xyOrigin.anchor !== anchor) draft.stock.xyOrigin = { anchor };
    moveDrawing(draft, geometry, offset);
    keepTouchOffOnStock(draft, stock);
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

/**
 * Adds the default touch-off pad (#147, ADR-0041, ADR-0043), as one undo
 * step: centred on the XY zero. Nothing if the project has one.
 */
export function addTouchOff(store: DocumentStore) {
  const { stock } = store.getState().document;
  if (stock.touchOff) return;
  const pad = defaultTouchOff(stock);
  store.getState().change("setStock.touchOff", (draft) => {
    draft.stock.touchOff = pad;
  });
}

/** Removes the touch-off pad, as one undo step. */
export function removeTouchOff(store: DocumentStore) {
  store.getState().change("setStock.touchOff", (draft) => {
    draft.stock.touchOff = null;
  });
}

/**
 * Sets the touch-off pad's centre along one axis (in millimetres from the
 * stock's bottom-left corner) or its diameter, which keeps the centre where
 * it is. A diameter wider than the stock's smaller side is refused, as the
 * document requires; returns whether the value was taken.
 */
export function setTouchOffField(
  store: DocumentStore,
  field: keyof TouchOffDisc,
  value: number,
): boolean {
  const { stock } = store.getState().document;
  if (!stock.touchOff) return false;
  if (field === "diameter" && !(value > 0 && value <= Math.min(stock.width, stock.height))) {
    return false;
  }
  store.getState().change(`setStock.touchOff.${field}`, (draft) => {
    if (draft.stock.touchOff) draft.stock.touchOff[field] = value;
  });
  return true;
}

/**
 * Sets the touch-off pad's own tool change (ADR-0043), in place of the
 * machine's, as one undo step; `null` or blank text goes back to the
 * machine's. Nothing without a pad.
 */
export function setTouchOffToolChange(store: DocumentStore, block: string | null) {
  const toolChange = block?.trim() ? block : null;
  store.getState().change("setStock.touchOff.toolChange", (draft) => {
    const pad = draft.stock.touchOff;
    if (pad && pad.toolChange !== toolChange) pad.toolChange = toolChange;
  });
}

/**
 * Makes the project two-sided (PRD-0011, ADR-0060), flipped about X, the
 * sides parting at half the deepest model's depth, or at half the stock's
 * thickness without a model; or one-sided again, moving every bottom-side
 * operation to the top side in the same undo step.
 */
export function setTwoSided(store: DocumentStore, twoSided: boolean) {
  const { stock, models } = store.getState().document;
  if (twoSided === (stock.twoSided !== null)) return;
  const deepest = Math.max(0, ...models.map(({ placement }) => placement.depth));
  // Within the parting depth field's limits, whatever the models' depth.
  const [min, max] = partingDepthLimits(stock.thickness);
  const half = Math.min(deepest > 0 ? deepest : stock.thickness, stock.thickness) / 2;
  const partingDepth = Math.min(Math.max(half, min), max);
  store.getState().change("setStock.twoSided", (draft) => {
    if (!twoSided) {
      draft.stock.twoSided = null;
      for (const operation of draft.operations) operation.stockSide = "top";
      return;
    }
    draft.stock.twoSided = { flipAxis: "x", partingDepth, pins: null };
  });
}

/** Sets the axis a two-sided project's stock is turned over about. */
export function setFlipAxis(store: DocumentStore, flipAxis: FlipAxis) {
  store.getState().change("setStock.flipAxis", (draft) => {
    if (draft.stock.twoSided) draft.stock.twoSided.flipAxis = flipAxis;
  });
}

/**
 * Sets how far below the stock top a two-sided project's sides part, in
 * millimetres; a depth outside the stock is refused.
 */
/** The parting depth's field limits: a tenth of a millimetre from either face, or the middle of thinner stock. */
export function partingDepthLimits(thickness: number): [min: number, max: number] {
  const margin = Math.min(0.1, thickness / 2);
  return [margin, thickness - margin];
}

export function setPartingDepth(store: DocumentStore, partingDepth: number) {
  const { thickness } = store.getState().document.stock;
  if (!(partingDepth > 0 && partingDepth < thickness)) return;
  store.getState().change("setStock.partingDepth", (draft) => {
    if (draft.stock.twoSided) draft.stock.twoSided.partingDepth = partingDepth;
  });
}

/**
 * Adds locating pins to a two-sided project (#356), as one undo step: two
 * 6 mm pins symmetric about the stock's centre, two fifths of its length
 * along the flip axis from it, through into the spoilboard. Or removes them;
 * drills of the pins then cut nothing until there are pins again.
 */
export function setLocatingPins(store: DocumentStore, on: boolean) {
  const { twoSided, width, height } = store.getState().document.stock;
  if (!twoSided || on === (twoSided.pins !== null)) return;
  const offset = Math.round(0.4 * (twoSided.flipAxis === "x" ? width : height));
  store.getState().change("setStock.pins", (draft) => {
    if (!draft.stock.twoSided) return;
    draft.stock.twoSided.pins = on
      ? {
          diameter: 6,
          positions: [-offset, offset],
          holes: { type: "through", spoilboardDepth: 5 },
        }
      : null;
  });
}

/**
 * Changes some of the locating pins' settings at once; refused unless the
 * result is valid `LocatingPins` with blind holes inside the stock. Returns whether they were taken.
 */
export function updateLocatingPins(store: DocumentStore, changes: Partial<LocatingPins>): boolean {
  const { twoSided, thickness } = store.getState().document.stock;
  const pins = twoSided?.pins;
  const parsed = LocatingPins.safeParse({ ...pins, ...changes });
  if (!pins || !parsed.success) return false;
  // Blind holes stay inside the stock, as the document requires.
  if (parsed.data.holes.type === "blind" && parsed.data.holes.depth >= thickness) return false;
  store.getState().change("setStock.pins", (draft) => {
    if (draft.stock.twoSided) draft.stock.twoSided.pins = parsed.data;
  });
  return true;
}
