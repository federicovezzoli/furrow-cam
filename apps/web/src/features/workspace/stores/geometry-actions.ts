import { alignShapes } from "@furrow/cam-core";
import type { ProjectDocument, Shape } from "@furrow/document";
import type { DocumentStore } from "./document-store";
import { defaultProjectTouchOff } from "./stock-actions";

/** Why another file can't be imported: a project holds one, a drawing or a model, for now. */
export const ONE_FILE =
  "A project holds one imported file: an SVG or DXF drawing, or an STL model.";

/** Whether the project already holds an imported file, a drawing or a model (ADR-0022, ADR-0031). */
export function hasImportedFile({ geometry, models }: ProjectDocument): boolean {
  return geometry.length > 0 || models.length > 0;
}

/**
 * Adds an imported file's shapes as one undo step, aligned to the stock at
 * the XY zero's anchor (ADR-0022), or at its bottom-left corner for a custom
 * zero, with the default touch-off pad if the project has none. Projects
 * hold one file for now: returns `false`, adding nothing, if the project
 * already has shapes or a model. `name` labels the change, e.g. `importSvg`.
 */
export function addImportedShapes(store: DocumentStore, name: string, shapes: Shape[]): boolean {
  const { document } = store.getState();
  if (hasImportedFile(document)) return false;
  const { stock } = document;
  const { anchor } = stock.xyOrigin;
  const placed = alignShapes(stock, shapes, anchor === "custom" ? "bottom_left" : anchor);
  store.getState().change(name, (draft) => {
    // The project has no shapes, so one assignment adds them as one patch.
    draft.geometry = placed;
    // The first file brings the default touch-off pad (#147).
    if (!draft.stock.touchOff) {
      draft.stock.touchOff = defaultProjectTouchOff({ ...document, geometry: placed });
    }
  });
  return true;
}
