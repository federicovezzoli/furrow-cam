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
