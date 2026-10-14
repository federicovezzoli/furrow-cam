import { alignShapes } from "@furrow/cam-core";
import type { Shape } from "@furrow/document";
import type { DocumentStore } from "./document-store";

/**
 * Adds an imported file's shapes as one undo step, aligned to the stock at
 * the XY zero's anchor (ADR-0022), or at its bottom-left corner for a custom
 * zero. Projects hold one file for now: returns `false`, adding nothing, if
 * the project already has shapes. `name` labels the change, e.g. `importSvg`.
 */
export function addImportedShapes(store: DocumentStore, name: string, shapes: Shape[]): boolean {
  const { stock, geometry } = store.getState().document;
  if (geometry.length > 0) return false;
  const { anchor } = stock.xyOrigin;
  const placed = alignShapes(stock, shapes, anchor === "custom" ? "bottom_left" : anchor);
  store.getState().change(name, (draft) => {
    // The project has no shapes, so one assignment adds them as one patch.
    draft.geometry = placed;
  });
  return true;
}
