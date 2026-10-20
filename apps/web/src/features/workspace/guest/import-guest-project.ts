import { DEFAULT_STL_LIMITS } from "@furrow/cam-core";
import {
  archiveMeshTooLarge,
  type ProjectDocument,
  projectNameFromFileName,
  readProjectJson,
} from "@furrow/document";
import { parseMesh } from "@furrow/workspace/lib/model-import";
import { documentMeshes, readArchive } from "@/features/projects/lib/archive-import";
import { createGuestProject, deleteGuestProject, type GuestProject, putGuestMesh } from "./storage";

const NOT_A_PROJECT = "This file isn't a Furrow CAM project.";
const NAME_MAX = 100;

function isArchive(file: File) {
  return /\.(zip|furrow)$/i.test(file.name) || file.type === "application/zip";
}

/** The project document in `contents`, upgraded to the current schema version. */
export function parseGuestProjectFile(contents: string): ProjectDocument {
  const read = readProjectJson(contents);
  switch (read.reason) {
    case undefined:
      return read.document;
    case "not_a_project":
      throw new Error(NOT_A_PROJECT);
    case "too_new":
      throw new Error(
        "This file was saved by a newer release of Furrow CAM. Reload the page to update.",
      );
    case "version":
      throw new Error(`This file can't be imported: ${read.error.message}.`);
    case "invalid":
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
  // Checked as an STL import is (PRD-0005 S1), so a damaged file can't leave a model that won't load.
  for (const [sha256, bytes] of meshes) {
    let mesh: Awaited<ReturnType<typeof parseMesh>>;
    try {
      // A copy: the worker takes the buffer it is sent.
      mesh = await parseMesh(bytes.slice().buffer, DEFAULT_STL_LIMITS);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "it couldn't be read.";
      throw new Error(`A model in this file can't be imported: ${reason}`);
    }
    if (mesh.sha256 !== sha256) throw new Error("A model in this file is damaged.");
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
