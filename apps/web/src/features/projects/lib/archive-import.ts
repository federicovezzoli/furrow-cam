import { DEFAULT_STL_LIMITS, parseFont, type StlLimits } from "@furrow/cam-core";
import {
  ARCHIVE_DOCUMENT_PATH,
  archiveMeshTooLarge,
  type ProjectArchive,
  ProjectArchiveError,
  type ProjectDocument,
  readProjectArchive,
} from "@furrow/document";
import { formatMessage, type Translatable } from "@furrow/ui/lib/i18n";
import { MeshImportError, parseMesh } from "@furrow/workspace/lib/model-import";
import { cacheAsset } from "@/features/assets/lib/asset-cache";
import { uploadAsset } from "@/features/assets/lib/assets";
import { deleteProject, saveProject, startArchiveImport } from "@/features/projects/actions";
import { clientTranslator } from "@/lib/client-translator";

const importFailed = () => clientTranslator()("Projects.importFailedConnection");

/**
 * Reads a `.furrow.zip` export; throws an `Error` for the user if it can't be
 * imported. Its meshes are only held to the default STL size limit, or
 * `limits` if higher: those only its versions use aren't imported, and
 * `importArchive` checks the others against `limits`.
 */
export async function readArchive(file: File, limits: StlLimits): Promise<ProjectArchive> {
  const ceiling = Math.max(limits.maxBytes, DEFAULT_STL_LIMITS.maxBytes);
  try {
    return await readProjectArchive(new Uint8Array(await file.arrayBuffer()), ceiling);
  } catch (error) {
    // Its message is a code; the importers show what it means.
    if (error instanceof ProjectArchiveError) {
      throw new Error(formatMessage(clientTranslator(), error.detail));
    }
    console.error(error);
    throw new Error(clientTranslator()("Projects.fileUnreadable"));
  }
}

/**
 * The meshes and fonts of `archive` its document uses (ADR-0029, ADR-0062):
 * those only its versions use are left out, as the versions are (ADR-0047).
 * A document that can't be read keeps them all, for the server to explain.
 */
export function documentAssets(archive: ProjectArchive): {
  meshes: Map<string, Uint8Array>;
  fonts: Map<string, Uint8Array>;
} {
  let document: Record<string, unknown> | null = null;
  try {
    document = JSON.parse(archive.contents) as Record<string, unknown> | null;
  } catch {
    // Kept whole below.
  }
  /** `files` that the document's `list` names by hash; all of them if it can't be read. */
  const used = (list: "models" | "fonts", files: Map<string, Uint8Array>) => {
    const entries = document?.[list];
    if (!Array.isArray(entries)) return files;
    const hashes = new Set(
      entries.map((entry: unknown) =>
        typeof entry === "object" && entry !== null && "sha256" in entry ? entry.sha256 : null,
      ),
    );
    return new Map([...files].filter(([sha256]) => hashes.has(sha256)));
  };
  return { meshes: used("models", archive.meshes), fonts: used("fonts", archive.fonts) };
}

/** What `importArchive` returns: the new project, or an error. */
export type ArchiveImport = { projectId: string; error?: never } | { error: Translatable };

/**
 * Creates a project from a `.furrow.zip` export read by `readArchive`
 * (ADR-0029), leaving out its versions. Each mesh the document uses is
 * checked as an STL import is (PRD-0005 S1), and each font it lists must
 * parse (ADR-0062); then the server creates the project with an empty
 * document, the meshes and fonts are uploaded to it, and the imported
 * document is saved. If any step after the
 * project is created fails, it is deleted again. `machineId` is as for
 * `importProject`; `projectName`, when given, names the project instead of `fileName`.
 */
export async function importArchive(
  archive: ProjectArchive,
  fileName: string,
  machineId: string | null,
  limits: StlLimits,
  projectName?: string,
): Promise<ArchiveImport> {
  const { meshes, fonts } = documentAssets(archive);
  for (const [sha256, bytes] of meshes) {
    if (bytes.byteLength > limits.maxBytes) {
      return {
        error: formatMessage(clientTranslator(), archiveMeshTooLarge(limits.maxBytes).detail),
      };
    }
    try {
      // A copy: the worker takes the buffer it is sent.
      const mesh = await parseMesh(bytes.slice().buffer, limits);
      // Checked when the archive was read; this only guards against a mix-up.
      if (mesh.sha256 !== sha256) return { error: clientTranslator()("Projects.modelDamaged") };
    } catch (error) {
      const t = clientTranslator();
      const reason =
        error instanceof MeshImportError
          ? formatMessage(t, error.detail)
          : t("Projects.unreadableReason");
      return { error: t("Projects.modelCantImport", { reason }) };
    }
  }

  for (const bytes of fonts.values()) {
    try {
      parseFont(bytes);
    } catch {
      return { error: clientTranslator()("Projects.fontCantImport") };
    }
  }

  let started: Awaited<ReturnType<typeof startArchiveImport>>;
  try {
    started = await startArchiveImport(
      // Sent as a file: a string argument would be escaped into JSON, outgrowing the body limit.
      new File([archive.contents], ARCHIVE_DOCUMENT_PATH, { type: "application/json" }),
      fileName,
      [...meshes, ...fonts].map(([sha256, bytes]) => ({ sha256, size: bytes.byteLength })),
      machineId,
      projectName,
    );
  } catch {
    return { error: importFailed() };
  }
  if (!started || !("projectId" in started)) return started ?? { error: importFailed() };
  const { projectId, document, updatedAt } = started;

  const error = await finish(projectId, archive, document, updatedAt);
  if (error === undefined) return { projectId };
  await deleteProject(projectId).catch(() => {
    // Left for the user to delete: it was created, but holds an empty document.
  });
  return { error };
}

/** Uploads the meshes and fonts `document` references to the new project `projectId`, then saves it. */
async function finish(
  projectId: string,
  archive: ProjectArchive,
  document: ProjectDocument,
  updatedAt: Date,
): Promise<Translatable | undefined> {
  try {
    const files = [
      ...[...new Set(document.models.map((model) => model.sha256))].map((sha256) => ({
        sha256,
        bytes: archive.meshes.get(sha256),
        kind: "mesh" as const,
      })),
      ...document.fonts.map(({ sha256 }) => ({
        sha256,
        bytes: archive.fonts.get(sha256),
        kind: "font" as const,
      })),
    ];
    for (const { sha256, bytes, kind } of files) {
      // The server checked that each model has its mesh, and each font its file.
      if (!bytes) return importFailed();
      const blob = new Blob([bytes as Uint8Array<ArrayBuffer>]);
      const uploaded = await uploadAsset(projectId, sha256, blob, kind);
      if (uploaded.error !== undefined) return uploaded.error;
      await cacheAsset(sha256, blob);
    }
    const saved = await saveProject(projectId, document, updatedAt);
    if (saved.error !== undefined) return saved.error;
  } catch (error) {
    console.error(error);
    return importFailed();
  }
}
