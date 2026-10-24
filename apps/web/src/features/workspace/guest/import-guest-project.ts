import { DEFAULT_STL_LIMITS, parseFont } from "@furrow/cam-core";
import {
  archiveMeshTooLarge,
  type ProjectDocument,
  projectNameFromFileName,
  readProjectJson,
} from "@furrow/document";
import { formatMessage } from "@furrow/ui/lib/i18n";
import { MeshImportError, parseMesh } from "@furrow/workspace/lib/model-import";
import { documentAssets, readArchive } from "@/features/projects/lib/archive-import";
import { clientTranslator } from "@/lib/client-translator";
import {
  createGuestProject,
  deleteGuestProject,
  type GuestProject,
  putGuestAsset,
} from "./storage";

const notAProject = () => clientTranslator()("Projects.notAProject");
const NAME_MAX = 100;

function isArchive(file: File) {
  return /\.(zip|furrow)$/i.test(file.name) || file.type === "application/zip";
}

/** The project document in `contents`, upgraded to the current schema version. */
export function parseGuestProjectFile(contents: string): ProjectDocument {
  const read = readProjectJson(contents);
  const t = clientTranslator();
  switch (read.reason) {
    case undefined:
      return read.document;
    case "not_a_project":
      throw new Error(notAProject());
    case "too_new":
      throw new Error(t("Guest.fileNewer"));
    case "version":
      throw new Error(t("Guest.fileCantImport", { reason: formatMessage(t, read.error.detail) }));
    case "invalid":
      throw new Error(t("Guest.fileCantImport", { reason: t("Guest.contentsInvalid") }));
  }
}

/** The project name a file called `fileName` gives, at most `NAME_MAX` characters. */
export function guestProjectName(fileName: string): string {
  const name = [...(projectNameFromFileName(fileName) ?? "").trim()].slice(0, NAME_MAX).join("");
  return name || clientTranslator()("Projects.importedProject");
}

/**
 * Creates a guest project from an exported `.furrow.json` file, a
 * `.furrow.zip` export or a desktop `.furrow` project (PRD-0008 G3), with
 * the STL files its models use; versions in a file are left out. Rejects with
 * an `Error` for the user, leaving nothing behind.
 */
export async function importGuestProject(file: File): Promise<GuestProject> {
  const archive = isArchive(file) ? await readArchive(file, DEFAULT_STL_LIMITS) : null;
  const document = parseGuestProjectFile(archive?.contents ?? (await file.text()));
  const { meshes, fonts } = archive
    ? documentAssets(archive)
    : { meshes: new Map<string, Uint8Array>(), fonts: new Map<string, Uint8Array>() };
  for (const font of document.fonts) {
    const bytes = fonts.get(font.sha256);
    if (!bytes) {
      const t = clientTranslator();
      throw new Error(
        archive
          ? t("Projects.meshOfMissing", { file: font.fileName })
          : t("Projects.modelsNeedZip"),
      );
    }
    if (bytes.byteLength !== font.size) {
      throw new Error(clientTranslator()("Projects.fileSizeMismatch", { file: font.fileName }));
    }
    try {
      parseFont(bytes);
    } catch {
      throw new Error(clientTranslator()("Projects.fontCantImport"));
    }
  }
  for (const model of document.models) {
    const bytes = meshes.get(model.sha256);
    if (!bytes) {
      const t = clientTranslator();
      throw new Error(
        archive
          ? t("Projects.meshOfMissing", { file: model.fileName })
          : t("Projects.modelsNeedZip"),
      );
    }
    if (bytes.byteLength > DEFAULT_STL_LIMITS.maxBytes) {
      const t = clientTranslator();
      throw new Error(formatMessage(t, archiveMeshTooLarge(DEFAULT_STL_LIMITS.maxBytes).detail));
    }
  }
  // Checked as an STL import is (PRD-0005 S1), so a damaged file can't leave a model that won't load.
  for (const [sha256, bytes] of meshes) {
    let mesh: Awaited<ReturnType<typeof parseMesh>>;
    try {
      // A copy: the worker takes the buffer it is sent.
      mesh = await parseMesh(bytes.slice().buffer, DEFAULT_STL_LIMITS);
    } catch (error) {
      const t = clientTranslator();
      const reason =
        error instanceof MeshImportError
          ? formatMessage(t, error.detail)
          : t("Projects.unreadableReason");
      throw new Error(t("Projects.modelCantImport", { reason }));
    }
    if (mesh.sha256 !== sha256) throw new Error(clientTranslator()("Projects.modelDamaged"));
  }

  const project = await createGuestProject(guestProjectName(file.name), document);
  try {
    for (const [sha256, bytes] of [...meshes, ...fonts]) {
      await putGuestAsset(project.id, sha256, new Blob([bytes.slice()]));
    }
  } catch (error) {
    await deleteGuestProject(project.id).catch(() => {});
    throw error;
  }
  return project;
}
