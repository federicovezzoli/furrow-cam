import type { PathRef } from "@furrow/cam-core";
import { normalizeTargets, type OperationTarget, type Shape } from "@furrow/document";

/** Every path of `shape`, as selecting it in the Geometry pane does. */
export function shapePaths(shape: Shape): PathRef[] {
  return shape.paths.map((_, path) => ({ shapeId: shape.id, path }));
}

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
 * How many shapes and paths `targets` cut, e.g. `2 selected shapes`,
 * `3 selected paths` or `1 selected shape and 2 paths`: whole shapes count as
 * shapes, the paths of the others one by one.
 */
export function targetsLabel(targets: OperationTarget[]): string {
  let shapes = 0;
  let paths = 0;
  for (const target of targets) {
    if (target.paths === null) shapes++;
    else paths += target.paths.length;
  }
  const noun = (n: number, word: string) => (n === 1 ? word : `${word}s`);
  const shapesLabel = `${shapes} selected ${noun(shapes, "shape")}`;
  if (paths === 0) return shapesLabel;
  if (shapes === 0) return `${paths} selected ${noun(paths, "path")}`;
  return `${shapesLabel} and ${paths} ${noun(paths, "path")}`;
}
