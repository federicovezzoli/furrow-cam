import { CURRENT_SCHEMA_VERSION, ProjectDocument } from "./document";

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
};

/** Thrown when a document can't be upgraded to the current schema version. */
export class ProjectDocumentVersionError extends Error {
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
    super(`Document version ${version} is newer than the supported version ${supportedVersion}`);
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
    throw new ProjectDocumentVersionError("A project document must be a JSON object");
  }
  const version = json.schemaVersion;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    throw new ProjectDocumentVersionError(`Invalid schemaVersion: ${JSON.stringify(version)}`);
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
      throw new ProjectDocumentVersionError(`No migration from version ${from} to ${from + 1}`);
    }
    const migrated: unknown = migrate(doc);
    if (!isObject(migrated)) {
      throw new ProjectDocumentVersionError(
        `Migration from version ${from} to ${from + 1} did not return an object`,
      );
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
