import { DEFAULT_STL_LIMITS } from "@furrow/cam-core";
import {
  type ArchiveVersion,
  missingArchiveMeshes,
  ProjectArchiveError,
  ProjectDocument,
  ProjectDocumentTooNewError,
  packProjectArchive,
  parseProjectDocument,
  readProjectArchive,
} from "@furrow/document";
import { formatMessage } from "@furrow/ui/lib/i18n";
import { t } from "./i18n";

/** A project as a file holds it: the document, its meshes by hash and its versions (ADR-0047). */
export type ProjectFile = {
  document: ProjectDocument;
  meshes: Map<string, Uint8Array>;
  versions: ArchiveVersion[];
};

/** Zip files start with `PK\x03\x04`. */
function isZip(bytes: Uint8Array) {
  return bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

/**
 * Reads a `.furrow` or `.furrow.zip` archive, or a `.furrow.json` document,
 * upgrading every document to the current schema version. Throws an `Error`
 * for the user if it can't be opened.
 */
export async function readProjectFile(
  bytes: Uint8Array,
  maxMeshBytes: number = DEFAULT_STL_LIMITS.maxBytes,
): Promise<ProjectFile> {
  if (!isZip(bytes)) {
    const document = parseDocument(new TextDecoder().decode(bytes));
    if (document.models.length > 0) {
      throw new Error(t("Desktop.ProjectFile.modelsNeedArchive"));
    }
    return { document, meshes: new Map(), versions: [] };
  }
  let archive: Awaited<ReturnType<typeof readProjectArchive>>;
  try {
    archive = await readProjectArchive(bytes, maxMeshBytes);
  } catch (error) {
    if (error instanceof ProjectArchiveError) throw new Error(formatMessage(t, error.detail));
    throw new Error(t("Desktop.ProjectFile.notAProject"));
  }
  const document = parseDocument(archive.contents);
  if (missingArchiveMeshes(document, archive.meshes).length > 0) {
    throw new Error(t("Desktop.ProjectFile.missingModel"));
  }
  return { document, meshes: archive.meshes, versions: archive.versions };
}

function parseDocument(contents: string): ProjectDocument {
  let json: unknown;
  try {
    json = JSON.parse(contents);
  } catch {
    throw new Error(t("Desktop.ProjectFile.notAProject"));
  }
  if (typeof json !== "object" || json === null || !("schemaVersion" in json)) {
    throw new Error(t("Desktop.ProjectFile.notAProject"));
  }
  try {
    return parseProjectDocument(json);
  } catch (error) {
    if (error instanceof ProjectDocumentTooNewError) {
      throw new Error(t("Desktop.ProjectFile.tooNew"));
    }
    throw new Error(t("Desktop.ProjectFile.invalid"));
  }
}

/** The project as a `.furrow` file; throws a `ProjectArchiveError` past the file's limits. */
export function writeProjectFile({ document, meshes, versions }: ProjectFile): Uint8Array {
  return packProjectArchive(ProjectDocument.parse(document), meshes, versions);
}
