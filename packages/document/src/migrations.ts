import { CURRENT_SCHEMA_VERSION, ProjectDocument } from "./document";

type UnknownDocument = Record<string, unknown>;

/** Upgrades a document by exactly one schema version. */
export type Migration = (doc: UnknownDocument) => UnknownDocument;

/**
 * `migrations[n]` upgrades a version `n` document to version `n + 1`. Every
 * schema change after the first production deploy bumps
 * `CURRENT_SCHEMA_VERSION` and adds an entry here.
 */
export const migrations: Readonly<Record<number, Migration>> = {};

/** Thrown when a document can't be upgraded to the current schema version. */
export class ProjectDocumentVersionError extends Error {
  override name = "ProjectDocumentVersionError";
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
    throw new ProjectDocumentVersionError(
      `Document version ${version} is newer than the supported version ${targetVersion}`,
    );
  }

  let doc = json;
  for (let from = version; from < targetVersion; from++) {
    const migrate = chain[from];
    if (!migrate) {
      throw new ProjectDocumentVersionError(`No migration from version ${from} to ${from + 1}`);
    }
    doc = { ...migrate(doc), schemaVersion: from + 1 };
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
