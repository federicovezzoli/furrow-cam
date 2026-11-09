import { type Operation, operationModelId, type ProjectDocument } from "@furrow/document";

type Objects = Pick<ProjectDocument, "drawings" | "geometry" | "models">;

/**
 * The ids of the shapes and models hidden or locked (ADR-0080): a shape is
 * when it is itself or its drawing is, so a drawing's flag wins over its
 * shapes' own.
 */
export function flaggedIds(doc: Objects, flag: "hidden" | "locked"): Set<string> {
  const drawings = new Set(doc.drawings.filter((drawing) => drawing[flag]).map(({ id }) => id));
  return new Set([
    ...doc.geometry
      .filter((shape) => shape[flag] || drawings.has(shape.drawingId))
      .map(({ id }) => id),
    ...doc.models.filter((model) => model[flag]).map(({ id }) => id),
  ]);
}

/**
 * How much of what `operation` cuts is in `hidden` (from `flaggedIds`):
 * `"all"` when its model is, or every shape it targets, `"some"` when only
 * some of its shapes are, `null` when none is or it targets nothing.
 */
export function hiddenTargets(
  operation: Operation,
  hidden: ReadonlySet<string>,
): "all" | "some" | null {
  const modelId = operationModelId(operation);
  if (modelId !== null && hidden.has(modelId)) return "all";
  const count = operation.targets.filter(({ shapeId }) => hidden.has(shapeId)).length;
  if (count === 0) return null;
  return count === operation.targets.length ? "all" : "some";
}

const machined = new WeakMap<ProjectDocument, ProjectDocument>();

/**
 * `doc` as it is machined (ADR-0080): hidden objects are not cut, so an
 * operation whose targets are all hidden is off and the others lose their
 * hidden targets. Derived on every read, never stored, so showing an object
 * brings its operations back as they were. `doc` itself when nothing is
 * hidden, and the same result for the same `doc`, so toolpath inputs keep
 * their identity.
 */
export function machinedDocument(doc: ProjectDocument): ProjectDocument {
  const known = machined.get(doc);
  if (known) return known;
  const hidden = flaggedIds(doc, "hidden");
  let result = doc;
  if (hidden.size > 0) {
    const operations = doc.operations.map((operation) => {
      const status = hiddenTargets(operation, hidden);
      if (status === null) return operation;
      if (status === "all") return operation.enabled ? { ...operation, enabled: false } : operation;
      return {
        ...operation,
        targets: operation.targets.filter(({ shapeId }) => !hidden.has(shapeId)),
      };
    });
    if (operations.some((operation, i) => operation !== doc.operations[i])) {
      result = { ...doc, operations };
    }
  }
  machined.set(doc, result);
  return result;
}
