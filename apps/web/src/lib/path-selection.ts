import type { PathRef } from "@furrow/cam-core";
import type { OperationTarget, Shape } from "@furrow/document";

/** A key for a path, to compare or collect path references. */
export function pathKey({ shapeId, path }: PathRef): string {
  return `${shapeId}:${path}`;
}

/** Every path of `shape`, as selecting it in the Geometry pane does. */
export function shapePaths(shape: Shape): PathRef[] {
  return shape.paths.map((_, path) => ({ shapeId: shape.id, path }));
}

/**
 * The operation targets of the selected paths (ADR-0018): one per shape, in
 * document order, with its paths ascending, or `null` once all are selected.
 * Paths no longer in `geometry` are skipped.
 */
export function selectionTargets(geometry: Shape[], selected: PathRef[]): OperationTarget[] {
  const byShape = new Map<string, Set<number>>();
  for (const { shapeId, path } of selected) {
    const paths = byShape.get(shapeId) ?? new Set();
    byShape.set(shapeId, paths.add(path));
  }
  return geometry.flatMap((shape) => {
    const chosen = byShape.get(shape.id);
    if (!chosen) return [];
    const paths = shape.paths.flatMap((_, index) => (chosen.has(index) ? [index] : []));
    if (paths.length === 0) return [];
    return [{ shapeId: shape.id, paths: paths.length === shape.paths.length ? null : paths }];
  });
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
