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
 * Whether `operation` cuts anything in `hidden` (from `flaggedIds`): its
 * model or any shape it targets. Such an operation is off (ADR-0080): cutting
 * only the rest would drop a pocket's islands, or move a profile's tabs and
 * start points onto the shapes left.
 */
export function cutsHidden(operation: Operation, hidden: ReadonlySet<string>): boolean {
  const modelId = operationModelId(operation);
  return (
    (modelId !== null && hidden.has(modelId)) ||
    operation.targets.some(({ shapeId }) => hidden.has(shapeId))
  );
}

/** The off copy of each operation, so it keeps its identity while it stays the same. */
const offCopies = new WeakMap<Operation, Operation>();
/** The last machined list of each `operations`, with the ids it turned off. */
const machined = new WeakMap<readonly Operation[], { off: string; operations: Operation[] }>();
const documents = new WeakMap<ProjectDocument, ProjectDocument>();

/**
 * `doc` as it is machined (ADR-0080): hidden objects are not cut, so an
 * operation that cuts any of them is off. Derived on every read, never
 * stored, so showing the object brings its operations back as they were.
 * `doc` itself when nothing it cuts is hidden; otherwise the same operations
 * for the same operations and hidden objects, so an unrelated edit doesn't
 * re-render what reads them.
 */
export function machinedDocument(doc: ProjectDocument): ProjectDocument {
  const known = documents.get(doc);
  if (known) return known;
  const hidden = flaggedIds(doc, "hidden");
  const off = doc.operations.filter(
    (operation) => operation.enabled && hidden.size > 0 && cutsHidden(operation, hidden),
  );
  let result = doc;
  if (off.length > 0) {
    const key = off.map(({ id }) => id).join();
    let last = machined.get(doc.operations);
    if (last?.off !== key) {
      const ids = new Set(off.map(({ id }) => id));
      last = {
        off: key,
        operations: doc.operations.map((operation) => {
          if (!ids.has(operation.id)) return operation;
          let copy = offCopies.get(operation);
          if (!copy) {
            copy = { ...operation, enabled: false };
            offCopies.set(operation, copy);
          }
          return copy;
        }),
      };
      machined.set(doc.operations, last);
    }
    result = { ...doc, operations: last.operations };
  }
  documents.set(doc, result);
  return result;
}
