import { anchorAlignment, translateShape } from "@furrow/cam-core";
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
  const offset = anchorAlignment(stock, shapes, anchor === "custom" ? "bottom_left" : anchor);
  const placed =
    offset[0] === 0 && offset[1] === 0
      ? shapes
      : shapes.map((shape) => translateShape(shape, offset));
  store.getState().change(name, (draft) => {
    // One by one: spreading a huge array into arguments overflows the stack.
    for (const shape of placed) draft.geometry.push(shape);
  });
  return true;
}
