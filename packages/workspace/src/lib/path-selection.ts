import type { PathRef } from "@furrow/cam-core";
import { normalizeTargets, type OperationTarget, type Shape } from "@furrow/document";

/**
 * The operation targets of the selected paths (ADR-0018), in the form the
 * document stores (see `normalizeTargets`): `null` once all of a shape's
 * paths are selected. Paths no longer in `geometry` are skipped.
 */
export function selectionTargets(geometry: Shape[], selected: PathRef[]): OperationTarget[] {
  return normalizeTargets(
    geometry,
    selected.map(({ shapeId, path }) => ({ shapeId, paths: [path] })),
  );
}
/**
 * The drawing whose properties show (PRD-0009 D2): the one every selected
 * path belongs to, or `null` when nothing is selected or the paths span
 * several drawings.
 */
export function selectedDrawingId(geometry: Shape[], selected: PathRef[]): string | null {
  const ids = new Set(selected.map(({ shapeId }) => shapeId));
  const drawingIds = new Set(geometry.filter(({ id }) => ids.has(id)).map((s) => s.drawingId));
  return drawingIds.size === 1 ? ([...drawingIds][0] as string) : null;
}

/**
 * How many shapes and paths `targets` cut, for `useTargetsLabel`: whole
 * shapes count as shapes, the paths of the others one by one.
 */
export function selectionCounts(targets: OperationTarget[]): { shapes: number; paths: number } {
  let shapes = 0;
  let paths = 0;
  for (const target of targets) {
    if (target.paths === null) shapes++;
    else paths += target.paths.length;
  }
  return { shapes, paths };
}
