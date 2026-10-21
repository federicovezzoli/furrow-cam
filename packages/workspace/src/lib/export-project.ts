import {
  PROJECT_ARCHIVE_EXTENSION,
  type ProjectDocument,
  packProjectArchive,
  projectFileName,
} from "@furrow/document";
import { downloadFile } from "@furrow/ui/lib/download";

/**
 * Downloads `projectDocument` as a `.furrow.json` file, or as a `.furrow.zip`
 * file with its meshes, read through `getMesh`, when it has 3D models
 * (ADR-0029). Throws what `getMesh` throws.
 */
export async function exportProjectFile(
  projectDocument: ProjectDocument,
  name: string,
  getMesh: (sha256: string) => Promise<ArrayBuffer>,
) {
  if (projectDocument.models.length === 0) {
    downloadFile(
      `${JSON.stringify(projectDocument, null, 2)}\n`,
      projectFileName(name),
      "application/json",
    );
    return;
  }
  const meshes = new Map<string, Uint8Array>();
  for (const { sha256 } of projectDocument.models) {
    if (!meshes.has(sha256)) meshes.set(sha256, new Uint8Array(await getMesh(sha256)));
  }
  downloadFile(
    packProjectArchive(projectDocument, meshes),
    projectFileName(name, PROJECT_ARCHIVE_EXTENSION),
    "application/zip",
  );
}
