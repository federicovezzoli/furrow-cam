import type { StlLimits } from "@furrow/cam-core";
import {
  type ProjectArchive,
  ProjectArchiveError,
  type ProjectDocument,
  readProjectArchive,
} from "@furrow/document";
import { uploadMesh } from "@/features/assets/lib/meshes";
import { deleteProject, saveProject, startArchiveImport } from "@/features/projects/actions";
import { cacheMesh } from "@/features/workspace/lib/mesh-cache";
import { parseMesh } from "@/features/workspace/lib/model-import";

const IMPORT_FAILED = "This file couldn't be imported. Check your connection and try again.";

/** Reads a `.furrow.zip` export; throws an `Error` for the user if it can't be imported. */
export async function readArchive(file: File, limits: StlLimits): Promise<ProjectArchive> {
  try {
    return await readProjectArchive(new Uint8Array(await file.arrayBuffer()), limits.maxBytes);
  } catch (error) {
    if (error instanceof ProjectArchiveError) throw error;
    console.error(error);
    throw new Error("This file couldn't be read.");
  }
}

/** What `importArchive` returns: the new project, an error, or that a machine must be chosen. */
export type ArchiveImport =
  | { projectId: string; error?: never }
  | { error: string }
  | { chooseMachine: true; error?: never };

/**
 * Creates a project from a `.furrow.zip` export read by `readArchive`
 * (ADR-0029). Each mesh is checked as an STL import is (PRD-0005 S1), then
 * the server creates the project with an empty document, the meshes are
 * uploaded to it, and the imported document is saved. If any step after the
 * project is created fails, it is deleted again. `machineId` is as for
 * `importProject`.
 */
export async function importArchive(
  archive: ProjectArchive,
  fileName: string,
  machineId: string | null,
  limits: StlLimits,
): Promise<ArchiveImport> {
  for (const [sha256, bytes] of archive.meshes) {
    try {
      // A copy: the worker takes the buffer it is sent.
      const mesh = await parseMesh(bytes.slice().buffer, limits);
      // Checked when the archive was read; this only guards against a mix-up.
      if (mesh.sha256 !== sha256) return { error: "A model in this file is damaged." };
    } catch (error) {
      const reason = error instanceof Error ? error.message : "it couldn't be read.";
      return { error: `A model in this file can't be imported: ${reason}` };
    }
  }

  let started: Awaited<ReturnType<typeof startArchiveImport>>;
  try {
    started = await startArchiveImport(
      archive.contents,
      fileName,
      [...archive.meshes].map(([sha256, bytes]) => ({ sha256, size: bytes.byteLength })),
      machineId,
    );
  } catch {
    return { error: IMPORT_FAILED };
  }
  if (!started || !("projectId" in started)) return started ?? { error: IMPORT_FAILED };
  const { projectId, document, updatedAt } = started;

  const error = await finish(projectId, archive, document, updatedAt);
  if (error === undefined) return { projectId };
  await deleteProject(projectId).catch(() => {
    // Left for the user to delete: it was created, but holds an empty document.
  });
  return { error };
}

/** Uploads the meshes `document` references to the new project `projectId`, then saves it. */
async function finish(
  projectId: string,
  archive: ProjectArchive,
  document: ProjectDocument,
  updatedAt: Date,
): Promise<string | undefined> {
  try {
    for (const sha256 of new Set(document.models.map((model) => model.sha256))) {
      const bytes = archive.meshes.get(sha256);
      // The server checked that each model has its mesh.
      if (!bytes) return IMPORT_FAILED;
      const blob = new Blob([bytes as Uint8Array<ArrayBuffer>]);
      const error = await uploadMesh(projectId, sha256, blob);
      if (error !== undefined) return error;
      await cacheMesh(sha256, blob);
    }
    const saved = await saveProject(projectId, document, updatedAt);
    if (saved.error !== undefined) return saved.error;
  } catch (error) {
    console.error(error);
    return IMPORT_FAILED;
  }
}
