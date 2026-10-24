import { z } from "zod";
import { CURRENT_SCHEMA_VERSION, ProjectDocument } from "./document";
import { DEFAULT_SPIN_UP_DELAY } from "./machine";
import { type DocumentMessage, MessageError } from "./message";

type UnknownDocument = Record<string, unknown>;

/** Upgrades a document by exactly one schema version. It may edit `doc` in place. */
export type Migration = (doc: UnknownDocument) => UnknownDocument;

/**
 * `migrations[n]` upgrades a version `n` document to version `n + 1`. Every
 * schema change after the first production deploy bumps
 * `CURRENT_SCHEMA_VERSION` and adds an entry here.
 */
export const migrations: Readonly<Record<number, Migration>> = {
  // ADR-0018: operations target paths. A v1 operation cut its shapes whole.
  1: (doc) => {
    if (Array.isArray(doc.operations)) {
      for (const operation of doc.operations) {
        if (isObject(operation) && Array.isArray(operation.shapeIds)) {
          operation.targets = operation.shapeIds.map((shapeId) => ({ shapeId, paths: null }));
          delete operation.shapeIds;
        }
      }
    }
    return doc;
  },
  // #44: machine profiles gained an entry clearance. Snapshots keep what
  // toolpaths used before: a fixed 1 mm (not today's default), capped at the
  // safe Z.
  2: (doc) => {
    const machine = doc.machine;
    if (isObject(machine)) {
      machine.entryClearance = typeof machine.safeZ === "number" ? Math.min(1, machine.safeZ) : 1;
    }
    return doc;
  },
  // #85: pockets choose a clearing strategy. Existing ones keep offset clearing.
  3: (doc) => {
    if (Array.isArray(doc.operations)) {
      for (const operation of doc.operations) {
        if (isObject(operation) && operation.type === "pocket" && isObject(operation.params)) {
          operation.params.strategy = { type: "offset" };
        }
      }
    }
    return doc;
  },
  // #95: engrave operations. Nothing to change; the bump keeps releases
  // without them from opening documents that have them.
  4: (doc) => doc,
  // #97: V-carve operations. Nothing to change, as for #95.
  5: (doc) => doc,
  // #113: imported 3D models (PRD-0005). Existing documents have none.
  6: (doc) => {
    doc.models = [];
    return doc;
  },
  // #115: 3D finishing operations. Nothing to change, as for #95.
  7: (doc) => doc,
  // #116: 3D roughing operations. Nothing to change, as for #95.
  8: (doc) => doc,
  // #118: rest machining. Existing 3D operations cut everything, as before.
  9: (doc) => {
    if (Array.isArray(doc.operations)) {
      for (const operation of doc.operations) {
        if (
          isObject(operation) &&
          (operation.type === "relief_finish" || operation.type === "relief_rough") &&
          isObject(operation.params)
        ) {
          operation.params.rest = false;
        }
      }
    }
    return doc;
  },
  // #146: 3D roughing boundaries become objects, to hold a margin's distance.
  10: (doc) => {
    if (Array.isArray(doc.operations)) {
      for (const operation of doc.operations) {
        if (
          isObject(operation) &&
          operation.type === "relief_rough" &&
          isObject(operation.params) &&
          typeof operation.params.boundary === "string"
        ) {
          operation.params.boundary = { type: operation.params.boundary };
        }
      }
    }
    return doc;
  },
  // #130: 3D finishing chooses a strategy. Existing operations keep their
  // parallel passes.
  11: (doc) => {
    if (Array.isArray(doc.operations)) {
      for (const operation of doc.operations) {
        if (
          isObject(operation) &&
          operation.type === "relief_finish" &&
          isObject(operation.params) &&
          !("strategy" in operation.params)
        ) {
          const { angle, direction, ...params } = operation.params;
          operation.params = { ...params, strategy: { type: "parallel", angle, direction } };
        }
      }
    }
    return doc;
  },
  // #147: touch-off pads. Existing projects have none.
  12: (doc) => {
    if (isObject(doc.stock) && !("touchOff" in doc.stock)) doc.stock.touchOff = null;
    return doc;
  },
  // ADR-0043: a pad's own tool change. Existing pads keep the machine's.
  13: (doc) => {
    const pad = isObject(doc.stock) ? doc.stock.touchOff : null;
    if (isObject(pad) && !("toolChange" in pad)) pad.toolChange = null;
    return doc;
  },
  // #240: machine profiles gained a spin-up delay. Snapshots get the default,
  // so the G-code they export waits for the spindle, which it didn't before.
  14: (doc) => {
    const machine = doc.machine;
    if (isObject(machine) && !("spinUpDelay" in machine)) {
      machine.spinUpDelay = DEFAULT_SPIN_UP_DELAY;
    }
    return doc;
  },
  // #183: the border Fit to stock leaves is the model's. Existing models
  // keep the one they were fitted with, whatever new models get later.
  15: (doc) => {
    const V15_BORDER = 10;
    if (Array.isArray(doc.models)) {
      for (const model of doc.models) {
        if (isObject(model) && !("border" in model)) model.border = V15_BORDER;
      }
    }
    return doc;
  },
  // #308: several drawings (ADR-0055). A project's shapes, all from one file,
  // become one drawing with the border models had then.
  16: (doc) => {
    if (Array.isArray(doc.drawings)) return doc;
    const shapes = Array.isArray(doc.geometry) ? doc.geometry.filter(isObject) : [];
    const [first] = shapes;
    if (!first) {
      doc.drawings = [];
      return doc;
    }
    // The first shape's id, so every read of a stored v16 document (and its
    // versions) gives the drawing the same one.
    const id = first.id;
    const name = typeof first.source === "string" && first.source !== "" ? first.source : "Drawing";
    doc.drawings = [{ id, name, border: 10 }];
    for (const shape of shapes) shape.drawingId = id;
    return doc;
  },
  // #332: the step-over moved from the tool to the operation. Operations
  // take their tool's, and 3D roughing its own or the tool's, so they cut
  // as before.
  17: (doc) => {
    if (!Array.isArray(doc.operations)) return doc;
    const takeStepOver = (tool: unknown) => {
      if (!isObject(tool)) return undefined;
      const { stepOver } = tool;
      delete tool.stepOver;
      return stepOver;
    };
    for (const operation of doc.operations) {
      if (!isObject(operation) || !isObject(operation.params)) continue;
      const { params } = operation;
      const stepOver = takeStepOver(operation.tool);
      if (operation.type === "pocket" || operation.type === "drill") params.stepOver = stepOver;
      if (operation.type === "relief_rough") params.stepOver ??= stepOver;
      if (isObject(params.flatBottom)) {
        params.flatBottom.stepOver = takeStepOver(params.flatBottom.tool);
      }
    }
    return doc;
  },
  // #347: text items (ADR-0059). Nothing to change, as for #95.
  18: (doc) => doc,
  // #354: two-sided projects (ADR-0060). Existing projects are cut from the
  // top only.
  19: (doc) => {
    if (isObject(doc.stock) && !("twoSided" in doc.stock)) doc.stock.twoSided = null;
    if (Array.isArray(doc.operations)) {
      for (const operation of doc.operations) {
        if (isObject(operation) && !("stockSide" in operation)) operation.stockSide = "top";
      }
    }
    return doc;
  },
  // #351: several lines and letter spacing. Text items keep their look: one
  // line, as they were laid out (a line break was a space), the line spacing
  // they'd have had, and no letter spacing.
  20: (doc) => {
    const V20_LINE_SPACING = 1.7;
    if (!Array.isArray(doc.drawings)) return doc;
    for (const drawing of doc.drawings) {
      if (!isObject(drawing) || !isObject(drawing.text)) continue;
      const { text } = drawing;
      if (typeof text.text === "string") text.text = text.text.replace(/\r\n|[\n\r]/g, " ");
      text.lineSpacing ??= V20_LINE_SPACING;
      text.letterSpacing ??= 0;
    }
    return doc;
  },
};

/** Thrown when a document can't be upgraded to the current schema version. */
export class ProjectDocumentVersionError extends MessageError<DocumentMessage> {
  override name = "ProjectDocumentVersionError";
}

/**
 * Thrown when a document was saved by a newer release than this one, e.g.
 * after a rollback or when importing a file from a newer instance.
 */
export class ProjectDocumentTooNewError extends ProjectDocumentVersionError {
  override name = "ProjectDocumentTooNewError";

  constructor(
    readonly version: number,
    readonly supportedVersion: number,
  ) {
    super({ code: "migration.tooNew", values: { version, supported: supportedVersion } });
  }
}

function isObject(value: unknown): value is UnknownDocument {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Runs the migration chain from the document's `schemaVersion` up to
 * `targetVersion`. The result is not validated; use `parseProjectDocument`.
 */
export function migrateProjectDocument(
  json: unknown,
  chain: Readonly<Record<number, Migration>> = migrations,
  targetVersion: number = CURRENT_SCHEMA_VERSION,
): unknown {
  if (!isObject(json)) {
    throw new ProjectDocumentVersionError({ code: "migration.notObject" });
  }
  const version = json.schemaVersion;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    throw new ProjectDocumentVersionError({
      code: "migration.invalidVersion",
      values: { version: JSON.stringify(version) ?? "undefined" },
    });
  }
  if (version > targetVersion) {
    throw new ProjectDocumentTooNewError(version, targetVersion);
  }

  if (version === targetVersion) {
    return json;
  }
  // Documents are plain JSON, so this deep copy lets migrations edit in place
  // without touching the caller's object.
  let doc: UnknownDocument = JSON.parse(JSON.stringify(json));
  for (let from = version; from < targetVersion; from++) {
    const migrate = chain[from];
    if (!migrate) {
      throw new ProjectDocumentVersionError({
        code: "migration.missing",
        values: { from, to: from + 1 },
      });
    }
    const migrated: unknown = migrate(doc);
    if (!isObject(migrated)) {
      throw new ProjectDocumentVersionError({
        code: "migration.notObjectResult",
        values: { from, to: from + 1 },
      });
    }
    doc = { ...migrated, schemaVersion: from + 1 };
  }
  return doc;
}

/**
 * Upgrades a stored or imported document to the current version and validates
 * it. Throws `ProjectDocumentVersionError` if it can't be upgraded and a
 * `ZodError` if it is invalid.
 */
export function parseProjectDocument(json: unknown): ProjectDocument {
  return ProjectDocument.parse(migrateProjectDocument(json));
}

/** Why `readProjectJson` couldn't read a project, with the error behind it. */
export type ProjectReadFailure =
  | { reason: "not_a_project"; error?: never }
  | { reason: "too_new"; error: ProjectDocumentTooNewError }
  | { reason: "version"; error: ProjectDocumentVersionError }
  | { reason: "invalid"; error: z.ZodError };

/**
 * `parseProjectDocument` for any input, JSON text included, that classifies
 * why it fails instead of throwing; callers word the reason themselves. Not a
 * JSON object with a `schemaVersion` (`package.json`, `[]`, …) is
 * `"not_a_project"`. Throws only unexpected errors.
 */
export function readProjectJson(
  input: unknown,
): { document: ProjectDocument; reason?: never } | ProjectReadFailure {
  let json = input;
  if (typeof input === "string") {
    try {
      json = JSON.parse(input);
    } catch {
      return { reason: "not_a_project" };
    }
  }
  if (!isObject(json) || !("schemaVersion" in json)) return { reason: "not_a_project" };
  try {
    return { document: parseProjectDocument(json) };
  } catch (error) {
    if (error instanceof ProjectDocumentTooNewError) return { reason: "too_new", error };
    if (error instanceof ProjectDocumentVersionError) return { reason: "version", error };
    if (error instanceof z.ZodError) return { reason: "invalid", error };
    throw error;
  }
}
