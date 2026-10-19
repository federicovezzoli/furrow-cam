import { DEFAULT_STL_LIMITS } from "@furrow/cam-core";
import {
  archiveMeshTooLarge,
  type ProjectDocument,
  ProjectDocumentTooNewError,
  ProjectDocumentVersionError,
  parseProjectDocument,
  projectNameFromFileName,
} from "@furrow/document";
import { documentMeshes, readArchive } from "@/features/projects/lib/archive-import";
import { createGuestProject, deleteGuestProject, type GuestProject, putGuestMesh } from "./storage";

const NOT_A_PROJECT = "This file isn't a Furrow CAM project.";
const NAME_MAX = 100;

function isArchive(file: File) {
  return /\.(zip|furrow)$/i.test(file.name) || file.type === "application/zip";
}

/** The project document in `contents`, upgraded to the current schema version. */
export function parseGuestProjectFile(contents: string): ProjectDocument {
  let json: unknown;
  try {
    json = JSON.parse(contents);
  } catch {
    throw new Error(NOT_A_PROJECT);
  }
  if (typeof json !== "object" || json === null || !("schemaVersion" in json)) {
    throw new Error(NOT_A_PROJECT);
  }
  try {
    return parseProjectDocument(json);
  } catch (error) {
    if (error instanceof ProjectDocumentTooNewError) {
      throw new Error(
        "This file was saved by a newer release of Furrow CAM. Reload the page to update.",
      );
    }
    if (error instanceof ProjectDocumentVersionError) {
      throw new Error(`This file can't be imported: ${error.message}.`);
    }
    throw new Error("This file can't be imported: its contents are invalid.");
  }
}

/** The project name a file called `fileName` gives, at most `NAME_MAX` characters. */
export function guestProjectName(fileName: string): string {
  const name = [...(projectNameFromFileName(fileName) ?? "").trim()].slice(0, NAME_MAX).join("");
  return name || "Imported project";
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
  const meshes = archive ? documentMeshes(archive) : new Map<string, Uint8Array>();
  for (const model of document.models) {
    const bytes = meshes.get(model.sha256);
    if (!bytes) {
      throw new Error(
        archive
          ? `This file can't be imported: the mesh of ${model.fileName} is missing.`
          : "This project has 3D models: import its .zip export instead.",
      );
    }
    if (bytes.byteLength > DEFAULT_STL_LIMITS.maxBytes) {
      throw new Error(archiveMeshTooLarge(DEFAULT_STL_LIMITS.maxBytes).message);
    }
  }

  const project = await createGuestProject(guestProjectName(file.name), document);
  try {
    for (const [sha256, bytes] of meshes) {
      await putGuestMesh(project.id, sha256, new Blob([bytes.slice()]));
    }
  } catch (error) {
    await deleteGuestProject(project.id).catch(() => {});
    throw error;
  }
  return project;
}
