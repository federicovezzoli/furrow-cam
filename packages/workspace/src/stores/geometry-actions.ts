import { alignShapes } from "@furrow/cam-core";
import { DRAWING_BORDER, type Shape } from "@furrow/document";
import type { DocumentStore } from "./document-store";

/**
 * Adds an imported file's shapes as a new drawing (ADR-0055), as one undo
 * step, aligned on its own to the stock at the XY zero's anchor (ADR-0022),
 * or at its bottom-left corner for a custom zero: it may overlap what the
 * project already holds. The shapes all name the new drawing, as an import
 * gives them, and it takes its name from their file. `name` labels the
 * change, e.g. `importSvg`.
 */
export function addImportedShapes(store: DocumentStore, name: string, shapes: Shape[]) {
  const [first] = shapes;
  if (!first) return;
  const { stock } = store.getState().document;
  const { anchor } = stock.xyOrigin;
  const placed = alignShapes(stock, shapes, anchor === "custom" ? "bottom_left" : anchor);
  const drawing = { id: first.drawingId, name: first.source ?? "", border: DRAWING_BORDER };
  store.getState().change(name, (draft) => {
    draft.drawings.push(drawing);
    draft.geometry.push(...placed);
  });
}

/**
 * Removes a drawing, its shapes and the operation targets that point at
 * them, as one undo step. An operation left with no targets goes too, as a
 * model's operations go with it (ADR-0055).
 */
export function removeDrawing(store: DocumentStore, id: string) {
  store.getState().change("removeDrawing", (draft) => {
    const index = draft.drawings.findIndex((drawing) => drawing.id === id);
    if (index === -1) return;
    draft.drawings.splice(index, 1);
    const removed = new Set(
      draft.geometry.filter((shape) => shape.drawingId === id).map((shape) => shape.id),
    );
    draft.geometry = draft.geometry.filter((shape) => !removed.has(shape.id));
    draft.operations = draft.operations.filter((operation) => {
      const targets = operation.targets.filter(({ shapeId }) => !removed.has(shapeId));
      if (targets.length === operation.targets.length) return true;
      operation.targets = targets;
      return targets.length > 0;
    });
  });
}
