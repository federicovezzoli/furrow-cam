import {
  PROJECT_ARCHIVE_EXTENSION,
  type ProjectDocument,
  packProjectArchive,
  projectFileName,
} from "@furrow/document";
import { downloadFile } from "@furrow/ui/lib/download";

/**
 * Downloads `projectDocument` as a `.furrow.json` file, or as a `.furrow.zip`
 * file with its meshes and fonts, read through `getFile`, when it has 3D
 * models or uploaded fonts (ADR-0029, ADR-0062). Throws what `getFile` throws.
 */
export async function exportProjectFile(
  projectDocument: ProjectDocument,
  name: string,
  getFile: (sha256: string, kind: "mesh" | "font") => Promise<ArrayBuffer>,
) {
  if (projectDocument.models.length === 0 && projectDocument.fonts.length === 0) {
    downloadFile(
      `${JSON.stringify(projectDocument, null, 2)}\n`,
      projectFileName(name),
      "application/json",
    );
    return;
  }
  const meshes = new Map<string, Uint8Array>();
  for (const { sha256 } of projectDocument.models) {
    if (!meshes.has(sha256)) meshes.set(sha256, new Uint8Array(await getFile(sha256, "mesh")));
  }
  const fonts = new Map<string, Uint8Array>();
  for (const { sha256 } of projectDocument.fonts) {
    fonts.set(sha256, new Uint8Array(await getFile(sha256, "font")));
  }
  downloadFile(
    packProjectArchive(projectDocument, meshes, [], fonts),
    projectFileName(name, PROJECT_ARCHIVE_EXTENSION),
    "application/zip",
  );
}
