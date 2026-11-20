import {
  DRAWING_BORDER,
  type Drawing,
  type Message,
  type OperationTarget,
  type Path,
  type PatternSettings,
  type ProjectDocument,
  type Shape,
  type ShapePaths,
} from "@furrow/document";
import type { DocumentStore } from "./document-store";
import { addDrawing, derivedPathsChange } from "./geometry-actions";

/** Why the selection can't be filled with a pattern, for the command's tooltip (PRD-0016 P1). */
export const PATTERN_NO_SELECTION: Message = { code: "workspace.patternNoSelection" };
export const PATTERN_ONE_DRAWING: Message = { code: "workspace.patternOneDrawing" };
export const PATTERN_OF_PATTERN: Message = { code: "workspace.patternOfPattern" };
export const PATTERN_NO_CLOSED_PATH: Message = { code: "workspace.patternNoClosedPath" };

/**
 * The boundary a pattern filling the paths `targets` select would have
 * (PRD-0016 P1, ADR-0087): their closed paths, all of one drawing that isn't
 * a pattern, a whole shape kept whole (its open paths are ignored), or why
 * there is none.
 */
export function patternBoundary(
  document: Pick<ProjectDocument, "geometry" | "drawings">,
  targets: readonly OperationTarget[],
): { ok: true; boundary: ShapePaths[] } | { ok: false; error: Message } {
  if (targets.length === 0) return { ok: false, error: PATTERN_NO_SELECTION };
  const ids = new Set(targets.map(({ shapeId }) => shapeId));
  const shapes = new Map(
    document.geometry.filter(({ id }) => ids.has(id)).map((shape) => [shape.id, shape]),
  );
  const drawings = new Set([...shapes.values()].map(({ drawingId }) => drawingId));
  if (drawings.size !== 1) return { ok: false, error: PATTERN_ONE_DRAWING };
  const [drawingId] = drawings;
  if (document.drawings.some(({ id, pattern }) => id === drawingId && pattern)) {
    return { ok: false, error: PATTERN_OF_PATTERN };
  }
  const boundary = targets.flatMap(({ shapeId, paths }): ShapePaths[] => {
    const shape = shapes.get(shapeId);
    if (!shape) return [];
    if (paths === null) return shape.paths.some(({ closed }) => closed) ? [{ shapeId, paths }] : [];
    const closed = paths.filter((i) => shape.paths[i]?.closed);
    return closed.length > 0 ? [{ shapeId, paths: closed }] : [];
  });
  return boundary.length > 0
    ? { ok: true, boundary }
    : { ok: false, error: PATTERN_NO_CLOSED_PATH };
}

/**
 * Adds a pattern (ADR-0087) as one undo step: `settings` with `paths`, its
 * cells generated inside its boundary, as its one shape, where they were
 * generated. Returns its id.
 */
export function addPatternItem(
  store: DocumentStore,
  name: string,
  settings: PatternSettings,
  paths: Path[],
): string {
  const id = crypto.randomUUID();
  const shape: Shape = { id: crypto.randomUUID(), name: "", layer: "", drawingId: id, paths };
  const drawing: Drawing = { id, name, border: DRAWING_BORDER, rotation: 0, pattern: settings };
  addDrawing(store, "addPattern", drawing, [shape]);
  return id;
}

/**
 * Sets pattern `id`'s settings to `settings` and its cells to `paths`,
 * generated from them, as one undo step (`derivedPathsChange`). Returns how
 * many profile tabs went with the old cells.
 */
export function setPatternItem(
  store: DocumentStore,
  id: string,
  settings: PatternSettings,
  paths: Path[],
): number {
  const { document } = store.getState();
  if (!document.drawings.some((drawing) => drawing.id === id && drawing.pattern)) return 0;
  const derived = derivedPathsChange(document, new Map([[id, paths]]));
  store.getState().change("setPattern", (draft) => {
    const drawing = draft.drawings.find((d) => d.id === id);
    if (drawing) drawing.pattern = settings;
    derived.apply(draft);
  });
  return derived.removedTabs;
}

/**
 * Turns pattern `id` into a plain drawing (PRD-0016 P9), as one undo step: it
 * keeps its cells, so the operations machining it still do, but no longer
 * follows its boundary.
 */
export function convertPatternToDrawing(store: DocumentStore, id: string) {
  store.getState().change("convertPattern", (draft) => {
    const drawing = draft.drawings.find((d) => d.id === id);
    if (drawing?.pattern) delete drawing.pattern;
  });
}
