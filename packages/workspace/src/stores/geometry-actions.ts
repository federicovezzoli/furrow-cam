import {
  alignShapes,
  anchorPoint,
  closedLoops,
  drawingFit,
  nearestOnLoops,
  type Rect,
  scalePoint,
  scaleShapes,
  shapesBounds,
} from "@furrow/cam-core";
import {
  DRAWING_BORDER,
  GEOMETRY_TOLERANCE,
  type Message,
  type Operation,
  type Point,
  type ProjectDocument,
  Shape,
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
 * step, aligned on its own to the stock at the XY zero's anchor (ADR-0022),
 * or at its bottom-left corner for a custom zero: it may overlap what the
 * project already holds. The shapes all name the new drawing, as an import
 * gives them, and it takes its name from their file. Returns `false`, adding
 * nothing, if the project holds a model. `name` labels the change, e.g.
 * `importSvg`.
 */
export function addImportedShapes(store: DocumentStore, name: string, shapes: Shape[]): boolean {
  const [first] = shapes;
  const { document } = store.getState();
  if (!first || !canImportDrawing(document)) return false;
  const { stock } = document;
  const { anchor } = stock.xyOrigin;
  const placed = alignShapes(stock, shapes, anchor === "custom" ? "bottom_left" : anchor);
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
export function drawingShapes({ geometry }: ProjectDocument, id: string): Shape[] {
  return geometry.filter((shape) => shape.drawingId === id);
}

/** The bounding box of drawing `id`, or `null` if it has no shapes. */
export function drawingBounds(document: ProjectDocument, id: string): Rect | null {
  return shapesBounds(drawingShapes(document, id));
}

/** The operations that machine only drawing `id`, which go with it. */
export function drawingOperations(document: ProjectDocument, id: string): Operation[] {
  const shapeIds = new Set(drawingShapes(document, id).map((shape) => shape.id));
  return document.operations.filter(
    ({ targets }) => targets.length > 0 && targets.every(({ shapeId }) => shapeIds.has(shapeId)),
  );
}

/** Whether a tab at `position` lies on one of `loops` (from `closedLoops`): tabs are placed on them. */
function onLoops(loops: Point[][], position: Point): boolean {
  const nearest = nearestOnLoops(loops, position);
  return nearest !== null && nearest.distance <= GEOMETRY_TOLERANCE;
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
  const shapes = drawingShapes(document, id);
  if (shapes.length === 0 || (scale === 1 && from[0] === to[0] && from[1] === to[1])) {
    return { ok: true };
  }
  const scaled = scaleShapes(shapes, scale, from, to);
  if (!scaled.every((shape) => Shape.safeParse(shape).success)) {
    return { ok: false, error: TOO_SMALL };
  }
  const byId = new Map(scaled.map((shape) => [shape.id, shape]));
  // One assignment, not one per shape, as on import.
  const geometry = document.geometry.map((shape) => byId.get(shape.id) ?? shape);
  const loops = closedLoops(shapes);
  store.getState().change(name, (draft) => {
    draft.geometry = geometry;
    for (const operation of draft.operations) {
      if (operation.type !== "profile" || !operation.params.tabs) continue;
      const { positions } = operation.params.tabs;
      positions.forEach((position, i) => {
        if (onLoops(loops, position)) positions[i] = scalePoint(position, scale, from, to);
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
  const bounds = drawingBounds(document, id);
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
  const bounds = drawingBounds(document, id);
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
  const loops = closedLoops(drawingShapes(store.getState().document, id));
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
      if (operation.type === "profile" && operation.params.tabs) {
        const { tabs } = operation.params;
        tabs.positions = tabs.positions.filter((position) => !onLoops(loops, position));
      }
      return targets.length > 0;
    });
  });
}
