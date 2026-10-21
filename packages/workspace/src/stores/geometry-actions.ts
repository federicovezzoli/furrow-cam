import {
  anchorPoint,
  closedLoops,
  drawingFit,
  nearestOnLoops,
  type Rect,
  scalePoint,
  scaleShapes,
  shapesBounds,
  stockInset,
  translateShapes,
} from "@furrow/cam-core";
import {
  DRAWING_BORDER,
  type Message,
  type Operation,
  type Point,
  type ProjectDocument,
  type Shape,
  segmentIssue,
} from "@furrow/document";
import type { DocumentStore } from "./document-store";
import { modelAnchor } from "./model-actions";
import type { ActionResult } from "./operation-actions";

/** Why a file can't be imported: a project holds SVG and DXF drawings or one STL model (ADR-0055). */
export const DRAWINGS_OR_MODEL: Message = { code: "workspace.drawingsOrModel" };

/** Whether the project can take another drawing: it holds no model. */
export function canImportDrawing({ models }: ProjectDocument): boolean {
  return models.length === 0;
}

/** Whether the project can take a model: it holds no drawing and no model. */
export function canImportModel({ geometry, models }: ProjectDocument): boolean {
  return geometry.length === 0 && models.length === 0;
}

/**
 * Adds an imported file's shapes as a new drawing (ADR-0055), as one undo
 * step, at its size in the file, aligned on its own at the XY zero's anchor
 * (bottom-left for a custom zero) to the stock less the drawing's border, the
 * rectangle *Fit to stock* fits into: it may overlap what the project already
 * holds. The shapes all name the new drawing, as an import
 * gives them, and it takes its name from their file. Returns `false`, adding
 * nothing, if the project holds a model. `name` labels the change, e.g.
 * `importSvg`.
 */
export function addImportedShapes(store: DocumentStore, name: string, shapes: Shape[]): boolean {
  const [first] = shapes;
  const { document } = store.getState();
  if (!first || !canImportDrawing(document)) return false;
  const { stock } = document;
  const anchor = modelAnchor(stock);
  const bounds = shapesBounds(shapes);
  if (!bounds) return false;
  const [x, y] = anchorPoint(stockInset(stock, DRAWING_BORDER), anchor);
  const [bx, by] = anchorPoint(bounds, anchor);
  const placed = translateShapes(shapes, [x - bx, y - by]);
  const drawing = { id: first.drawingId, name: first.source ?? "", border: DRAWING_BORDER };
  // One assignment, not a spread push: a file may hold more shapes than a call takes arguments.
  const geometry = document.geometry.concat(placed);
  store.getState().change(name, (draft) => {
    draft.drawings.push(drawing);
    draft.geometry = geometry;
  });
  return true;
}

/** The shapes of drawing `id`. */
export function drawingShapes(geometry: Shape[], id: string): Shape[] {
  return geometry.filter((shape) => shape.drawingId === id);
}

/** The bounding box of drawing `id`, or `null` if it has no shapes. */
export function drawingBounds(geometry: Shape[], id: string): Rect | null {
  return shapesBounds(drawingShapes(geometry, id));
}

/** The operations that machine only drawing `id`, which go with it. */
export function drawingOperations(document: ProjectDocument, id: string): Operation[] {
  const shapeIds = new Set(drawingShapes(document.geometry, id).map((shape) => shape.id));
  return document.operations.filter(
    ({ targets }) => targets.length > 0 && targets.every(({ shapeId }) => shapeIds.has(shapeId)),
  );
}

/**
 * Which tab positions of each profile targeting drawing `id` belong to it,
 * by operation id: those nearer its paths than the profile's other targets'
 * (ADR-0055). Tabs are placed on the paths, but a tolerance can't tell after
 * a scale moves them off the new flattening; a tie, coincident shapes of two
 * drawings, stays with the other drawing.
 */
function drawingTabs(document: ProjectDocument, id: string): Map<string, boolean[]> {
  const shapes = new Map(document.geometry.map((shape) => [shape.id, shape]));
  const tabs = new Map<string, boolean[]>();
  for (const operation of document.operations) {
    if (operation.type !== "profile" || !operation.params.tabs) continue;
    const targeted = operation.targets.flatMap(({ shapeId }) => shapes.get(shapeId) ?? []);
    const mine = closedLoops(targeted.filter((shape) => shape.drawingId === id));
    if (mine.length === 0) continue;
    const others = closedLoops(targeted.filter((shape) => shape.drawingId !== id));
    tabs.set(
      operation.id,
      operation.params.tabs.positions.map((position) => {
        const near = nearestOnLoops(mine, position);
        const other = nearestOnLoops(others, position);
        return near !== null && (other === null || near.distance < other.distance);
      }),
    );
  }
  return tabs;
}

/** Whether a segment of `shapes` has no length, or an arc no radius (`segmentIssue`). */
function degenerate(shapes: Shape[]): boolean {
  return shapes.some(({ paths }) =>
    paths.some(({ start, segments }) =>
      segments.some((segment, i) => segmentIssue(segments[i - 1]?.to ?? start, segment) !== null),
    ),
  );
}

const TOO_SMALL: Message = { code: "workspace.drawingTooSmall" };

/**
 * Scales drawing `id` by `scale` about `from`, which lands on `to`
 * (`scaleShapes`), as one undo step, and the profile tabs lying on its paths
 * with it (ADR-0055). Refuses, changing nothing, a scale that shrinks a
 * segment to nothing: the document would be invalid.
 */
function scaleDrawing(
  store: DocumentStore,
  name: string,
  id: string,
  scale: number,
  from: Point,
  to: Point,
): ActionResult {
  const { document } = store.getState();
  const shapes = drawingShapes(document.geometry, id);
  if (shapes.length === 0 || (scale === 1 && from[0] === to[0] && from[1] === to[1])) {
    return { ok: true };
  }
  const scaled = scaleShapes(shapes, scale, from, to);
  if (degenerate(scaled)) return { ok: false, error: TOO_SMALL };
  const byId = new Map(scaled.map((shape) => [shape.id, shape]));
  // One assignment, not one per shape, as on import.
  const geometry = document.geometry.map((shape) => byId.get(shape.id) ?? shape);
  const tabs = drawingTabs(document, id);
  store.getState().change(name, (draft) => {
    draft.geometry = geometry;
    for (const operation of draft.operations) {
      const moved = tabs.get(operation.id);
      if (!moved || operation.type !== "profile" || !operation.params.tabs) continue;
      const { positions } = operation.params.tabs;
      positions.forEach((position, i) => {
        if (moved[i]) positions[i] = scalePoint(position, scale, from, to);
      });
    }
  });
  return { ok: true };
}

/**
 * Sets drawing `id`'s width or height to `value` millimetres, scaling it the
 * same both ways so it keeps its proportions, about its point at the zero's
 * anchor (`modelAnchor`), which stays put.
 */
export function setDrawingSize(
  store: DocumentStore,
  id: string,
  axis: "width" | "height",
  value: number,
): ActionResult {
  const { document } = store.getState();
  const bounds = drawingBounds(document.geometry, id);
  if (!bounds) return { ok: true };
  const i = axis === "width" ? 0 : 1;
  const extent = (bounds.max[i] as number) - (bounds.min[i] as number);
  if (extent <= 0) return { ok: true };
  const anchor = anchorPoint(bounds, modelAnchor(document.stock));
  return scaleDrawing(store, `setDrawing.${axis}`, id, value / extent, anchor, anchor);
}

/**
 * Scales drawing `id` to fit inside the stock less its border, aligned to it
 * at the zero's anchor (`drawingFit`).
 */
export function fitDrawingToStock(store: DocumentStore, id: string): ActionResult {
  const { document } = store.getState();
  const drawing = document.drawings.find((d) => d.id === id);
  const bounds = drawingBounds(document.geometry, id);
  if (!drawing || !bounds) return { ok: true };
  const fit = drawingFit(bounds, document.stock, modelAnchor(document.stock), drawing.border);
  if (!fit) return { ok: true };
  return scaleDrawing(store, "fitDrawing", id, fit.scale, fit.from, fit.to);
}

/** Sets the border *Fit to stock* leaves around drawing `id`, without fitting it. */
export function setDrawingBorder(store: DocumentStore, id: string, border: number) {
  store.getState().change("setDrawing.border", (draft) => {
    const drawing = draft.drawings.find((d) => d.id === id);
    if (drawing && drawing.border !== border) drawing.border = border;
  });
}

/**
 * Removes a drawing, its shapes and the operation targets that point at
 * them, as one undo step. An operation left with no targets goes too, as a
 * model's operations go with it, and so do the tabs lying on its paths
 * (ADR-0055).
 */
export function removeDrawing(store: DocumentStore, id: string) {
  const ownTabs = drawingTabs(store.getState().document, id);
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
      const gone = ownTabs.get(operation.id);
      const tabs = operation.type === "profile" ? operation.params.tabs : null;
      if (gone && tabs) tabs.positions = tabs.positions.filter((_, i) => !gone[i]);
      return targets.length > 0;
    });
  });
}
