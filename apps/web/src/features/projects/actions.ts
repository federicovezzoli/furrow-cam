"use server";

import {
  createProjectDocument,
  type Machine,
  ProjectDocument,
  projectNameFromFileName,
} from "@furrow/document";
import { MAX_VERSIONS, VERSION_LABEL_MAX } from "@furrow/workspace/lib/versions";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  copyAssets,
  deleteProjectObjects,
  isStorageConfigured,
  MAX_MESH_BYTES,
  missingAssets,
} from "@/features/assets/server";
import { getUserId } from "@/features/auth/server";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { type ActionResult, type FormErrors, SIGNED_OUT } from "@/lib/form-data";
import {
  documentColumns,
  getProject,
  listVersions,
  lockProject,
  PROJECT_NAME_MAX,
  parseName,
  parseProjectFile,
  parseProjectId,
  parseStoredDocument,
  parseVersionLabel,
  snapshotUserMachine,
  truncate,
  type VersionRow,
} from "./server";

export type ProjectFormErrors = FormErrors<"name" | "machine">;

const NOT_FOUND = "This project no longer exists.";
const VERSION_NOT_FOUND = "This version no longer exists.";
const TOO_MANY_VERSIONS = `This project already has ${MAX_VERSIONS} versions, the most it can keep. Delete one first.`;
const MESH_MISSING = "a model's mesh hasn't been uploaded.";
const CONFLICT =
  "This project was changed somewhere else since you opened it. Reload it to see the latest version.";

/**
 * Creates an empty project and opens it, for one of the user's machines or,
 * when the form names none, without one: it is chosen in the project before
 * exporting G-code (PRD-0008 G13).
 */
export async function createProject(form: FormData): Promise<ProjectFormErrors> {
  const userId = await getUserId();
  if (!userId) return { form: SIGNED_OUT };
  const name = parseName(form.get("name"));
  if (!name.success) return { name: name.error.issues[0]?.message };
  const machineId = form.get("machine");
  let machine: Machine | null = null;
  if (machineId !== null && machineId !== "") {
    const snapshot = await snapshotUserMachine(userId, machineId);
    if (snapshot.error !== undefined) return { machine: snapshot.error };
    machine = snapshot.machine;
  }

  const document = { ...createProjectDocument(), machine };
  const { id } = await db.project.create({
    data: { userId, name: name.data, ...documentColumns(document) },
    select: { id: true },
  });
  revalidatePath("/projects");
  redirect(`/projects/${id}`);
}

/**
 * The document of an exported file `contents` called `fileName`, upgraded to
 * the current schema version and validated, and the name to give its
 * project. A file's machine snapshot is kept; a file without one gets the
 * user's machine `machineId`, or stays without a machine when it is `null`
 * (PRD-0008 G13). Models are refused unless the file is a zip export, which
 * carries their meshes (ADR-0029).
 */
async function prepareImport(
  userId: string,
  contents: string,
  fileName: string,
  machineId: string | null,
  { archive }: { archive: boolean },
): Promise<{ document: ProjectDocument; name: string; error?: never } | { error: string }> {
  const parsed = parseProjectFile(contents);
  if (parsed.error !== undefined) return { error: parsed.error };
  let document = parsed.document;
  if (!archive && document.models.length > 0) {
    return { error: "This project has 3D models: import its .zip export instead." };
  }
  if (document.machine === null && machineId !== null) {
    const snapshot = await snapshotUserMachine(userId, machineId);
    if (snapshot.error !== undefined) return { error: snapshot.error };
    document = { ...document, machine: snapshot.machine };
  }
  const name = parseName(truncate(projectNameFromFileName(fileName) ?? "", PROJECT_NAME_MAX));
  return { document, name: name.success ? name.data : "Imported project" };
}

/**
 * Creates a project from an exported `.furrow.json` file and opens it; the
 * name comes from the file name. A file without a machine snapshot gets the
 * user's machine `machineId`, if any. Only errors come back.
 */
export async function importProject(file: File, machineId: string | null): Promise<ActionResult> {
  const userId = await getUserId();
  if (!userId) return { error: SIGNED_OUT };
  if (!(file instanceof File)) return { error: "Pick a file to import." };
  const prepared = await prepareImport(userId, await file.text(), file.name, machineId, {
    archive: false,
  });
  if (!("document" in prepared)) return prepared;
  const { document, name } = prepared;

  const { id } = await db.project.create({
    data: { userId, name, ...documentColumns(document) },
    select: { id: true },
  });
  revalidatePath("/projects");
  redirect(`/projects/${id}`);
}

/**
 * Creates a project from a guest project's document (PRD-0008 G7), checked
 * as `importProject` checks a file, and returns its id instead of opening
 * it, so several can be imported in turn. `fileName` gives the name, as a
 * file's does. Documents with models go through `startArchiveImport`.
 */
export async function importGuestDocument(
  documentFile: File,
  fileName: string,
): Promise<{ projectId: string; error?: never } | { error: string }> {
  const userId = await getUserId();
  if (!userId) return { error: SIGNED_OUT };
  if (!(documentFile instanceof File)) return { error: "Pick a file to import." };
  const prepared = await prepareImport(userId, await documentFile.text(), String(fileName), null, {
    archive: false,
  });
  if (!("document" in prepared)) return prepared;
  const { document, name } = prepared;

  const { id } = await db.project.create({
    data: { userId, name, ...documentColumns(document) },
    select: { id: true },
  });
  revalidatePath("/projects");
  return { projectId: id };
}

/** What `startArchiveImport` returns: the new project to finish, or an error. */
export type ArchiveImportResult =
  | { projectId: string; document: ProjectDocument; updatedAt: Date; error?: never }
  | { error: string };

/**
 * Starts importing a `.furrow.zip` export (ADR-0029): `documentFile` is its
 * document (a file, so it is sent as is rather than escaped into JSON),
 * `meshes` the hashes and sizes of the mesh files the browser found in it,
 * and `fileName` the zip's name. The document is prepared as by
 * `importProject`, and every model must have its mesh. The project is created
 * with an empty document; the browser then uploads the meshes and saves the
 * returned document with `saveProject`, or deletes the project if a step
 * fails.
 */
export async function startArchiveImport(
  documentFile: File,
  fileName: string,
  meshes: { sha256: string; size: number }[],
  machineId: string | null,
): Promise<ArchiveImportResult> {
  const userId = await getUserId();
  if (!userId) return { error: SIGNED_OUT };
  if (!isStorageConfigured()) {
    return { error: "This project has 3D models, which this server can't store." };
  }
  if (!(documentFile instanceof File)) return { error: "Pick a file to import." };
  const prepared = await prepareImport(
    userId,
    await documentFile.text(),
    String(fileName),
    machineId,
    { archive: true },
  );
  if (!("document" in prepared)) return prepared;
  const { document, name } = prepared;
  const sizes = new Map(
    Array.isArray(meshes) ? meshes.map(({ sha256, size }) => [sha256, size]) : [],
  );
  for (const model of document.models) {
    const size = sizes.get(model.sha256);
    if (size === undefined) {
      return { error: `This file can't be imported: the mesh of ${model.fileName} is missing.` };
    }
    if (typeof size !== "number" || size > MAX_MESH_BYTES) {
      return {
        error: `This file can't be imported: ${model.fileName} is larger than ${MAX_MESH_BYTES / 1_000_000} MB, the most allowed.`,
      };
    }
  }

  const { id, updatedAt } = await db.project.create({
    data: {
      userId,
      name,
      // Meshes it references are uploaded first: saving checks that they are (ADR-0029).
      ...documentColumns({ ...createProjectDocument(), machine: document.machine }),
    },
    select: { id: true, updatedAt: true },
  });
  revalidatePath("/projects");
  return { projectId: id, document, updatedAt };
}

export async function renameProject(id: string, name: string): Promise<ActionResult> {
  const userId = await getUserId();
  if (!userId) return { error: SIGNED_OUT };
  const projectId = parseProjectId(id);
  if (!projectId) return { error: NOT_FOUND };
  const parsed = parseName(name);
  if (!parsed.success) return { error: `Name: ${parsed.error.issues[0]?.message}` };

  const { count } = await db.project.updateMany({
    where: { id: projectId, userId },
    data: { name: parsed.data },
  });
  if (count === 0) return { error: NOT_FOUND };
  revalidatePath("/projects");
}

export async function deleteProject(id: string): Promise<ActionResult> {
  const userId = await getUserId();
  if (!userId) return { error: SIGNED_OUT };
  const projectId = parseProjectId(id);
  if (!projectId) return { error: NOT_FOUND };

  const { count } = await db.project.deleteMany({ where: { id: projectId, userId } });
  if (count === 0) return { error: NOT_FOUND };
  await deleteProjectObjects(userId, projectId);
  revalidatePath("/projects");
}

/**
 * A project's name and document, upgraded to the current schema version.
 * Pass its `updatedAt` back to `saveProject`.
 */
export async function loadProject(id: string) {
  const userId = await getUserId();
  if (!userId) return { error: SIGNED_OUT };
  const project = await getProject(userId, id);
  if (!project) return { error: NOT_FOUND };
  if (project.error !== undefined) return { error: project.error };
  return { project };
}

/**
 * Replaces a project's document. It must be valid for the current schema
 * version: the client always edits upgraded documents, so older versions are
 * rejected rather than migrated (ADR-0003).
 *
 * `updatedAt` is the version the client last loaded or saved. If the project
 * was saved elsewhere since (another tab or device), nothing is written, so
 * neither copy silently overwrites the other. Returns the new `updatedAt`.
 */
export async function saveProject(
  id: string,
  document: unknown,
  updatedAt: Date,
): Promise<{ updatedAt: Date; error?: never } | { error: string }> {
  const userId = await getUserId();
  if (!userId) return { error: SIGNED_OUT };
  const projectId = parseProjectId(id);
  if (!projectId) return { error: NOT_FOUND };
  const parsed = ProjectDocument.safeParse(document);
  if (!parsed.success) {
    return { error: `The project couldn't be saved: ${z.prettifyError(parsed.error)}` };
  }
  const meshes = parsed.data.models.map(({ sha256 }) => sha256);

  try {
    return await db.$transaction(async (tx) => {
      // Locked so a mesh can't be discarded between the check and the write (`discardMesh`).
      await lockProject(tx, projectId);
      if ((await missingAssets(userId, projectId, meshes, tx)).length > 0) {
        return { error: `The project couldn't be saved: ${MESH_MISSING}` };
      }
      // No revalidation: the list is rendered per request, and autosave would invalidate it constantly.
      return await tx.project.update({
        where: { id: projectId, userId, updatedAt },
        data: documentColumns(parsed.data),
        select: { updatedAt: true },
      });
    });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025")) {
      throw error;
    }
    const exists = await db.project.count({ where: { id: projectId, userId } });
    return { error: exists ? CONFLICT : NOT_FOUND };
  }
}

/** A project's versions after an action on them, newest first, or why the action failed. */
export type VersionsResult = { versions: VersionRow[]; error?: never } | { error: string };

/** The versions of one of the user's projects (ADR-0028). */
export async function getVersions(projectId: string): Promise<VersionsResult> {
  const userId = await getUserId();
  if (!userId) return { error: SIGNED_OUT };
  const id = parseProjectId(projectId);
  if (!id) return { error: NOT_FOUND };
  return { versions: await listVersions(userId, id) };
}

/**
 * Saves the project's stored document as a version, not one sent by the
 * client: flush autosave first. `updatedAt` is the version the client last
 * saved; if the project was saved elsewhere since, nothing is created.
 */
export async function createVersion(
  projectId: string,
  label: string,
  updatedAt: Date,
): Promise<VersionsResult> {
  const userId = await getUserId();
  if (!userId) return { error: SIGNED_OUT };
  const id = parseProjectId(projectId);
  if (!id) return { error: NOT_FOUND };
  const parsed = parseVersionLabel(label);
  if (!parsed.success) return { error: `Label: ${parsed.error.issues[0]?.message}` };

  const error = await db.$transaction(async (tx) => {
    await lockProject(tx, id);
    const project = await tx.project.findFirst({
      where: { id, userId },
      select: { schemaVersion: true, document: true, updatedAt: true },
    });
    if (!project) return NOT_FOUND;
    if (project.updatedAt.getTime() !== updatedAt.getTime()) return CONFLICT;
    if ((await tx.projectVersion.count({ where: { projectId: id } })) >= MAX_VERSIONS) {
      return TOO_MANY_VERSIONS;
    }
    await tx.projectVersion.create({
      data: {
        projectId: id,
        label: parsed.data,
        schemaVersion: project.schemaVersion,
        document: project.document as Prisma.InputJsonObject,
      },
    });
  });
  if (error) return { error };
  return { versions: await listVersions(userId, id) };
}

/** Relabels one of the user's versions; a blank label shows its date instead. */
export async function renameVersion(id: string, label: string): Promise<ActionResult> {
  const userId = await getUserId();
  if (!userId) return { error: SIGNED_OUT };
  const versionId = parseProjectId(id);
  if (!versionId) return { error: VERSION_NOT_FOUND };
  const parsed = parseVersionLabel(label);
  if (!parsed.success) return { error: `Label: ${parsed.error.issues[0]?.message}` };

  const { count } = await db.projectVersion.updateMany({
    where: { id: versionId, project: { userId } },
    data: { label: parsed.data },
  });
  if (count === 0) return { error: VERSION_NOT_FOUND };
}

export async function deleteVersion(id: string): Promise<ActionResult> {
  const userId = await getUserId();
  if (!userId) return { error: SIGNED_OUT };
  const versionId = parseProjectId(id);
  if (!versionId) return { error: VERSION_NOT_FOUND };

  const { count } = await db.projectVersion.deleteMany({
    where: { id: versionId, project: { userId } },
  });
  if (count === 0) return { error: VERSION_NOT_FOUND };
}

/**
 * Replaces the project's document with version `id`, upgraded to the current
 * schema version (ADR-0028). The document it replaces is kept as an automatic
 * version first, so a restore can be undone; both happen or neither does.
 * `updatedAt` is checked as by `saveProject`. Returns the restored document
 * and its `updatedAt`, which the client loads in place of its own.
 */
export async function restoreVersion(
  id: string,
  updatedAt: Date,
): Promise<
  | { document: ProjectDocument; updatedAt: Date; versions: VersionRow[]; error?: never }
  | { error: string }
> {
  const userId = await getUserId();
  if (!userId) return { error: SIGNED_OUT };
  const versionId = parseProjectId(id);
  if (!versionId) return { error: VERSION_NOT_FOUND };

  let result: { error: string } | { projectId: string; document: ProjectDocument; updatedAt: Date };
  let projectId: string | undefined;
  try {
    result = await db.$transaction(async (tx) => {
      const version = await tx.projectVersion.findFirst({
        where: { id: versionId, project: { userId } },
        select: {
          label: true,
          document: true,
          project: { select: { id: true, schemaVersion: true, document: true, updatedAt: true } },
        },
      });
      if (!version) return { error: VERSION_NOT_FOUND };
      const { project } = version;
      projectId = project.id;
      const parsed = parseStoredDocument(version.document, "This version can't be restored");
      if (parsed.error !== undefined) return { error: parsed.error };
      if (project.updatedAt.getTime() !== updatedAt.getTime()) return { error: CONFLICT };
      await lockProject(tx, project.id);
      if ((await tx.projectVersion.count({ where: { projectId: project.id } })) >= MAX_VERSIONS) {
        return { error: TOO_MANY_VERSIONS };
      }

      await tx.projectVersion.create({
        data: {
          projectId: project.id,
          label: truncate(
            version.label === null
              ? "Before restoring an earlier version"
              : `Before restoring “${version.label}”`,
            VERSION_LABEL_MAX,
          ),
          schemaVersion: project.schemaVersion,
          document: project.document as Prisma.InputJsonObject,
        },
      });
      const saved = await tx.project.update({
        // Checked again here: it was read before the row was locked.
        where: { id: project.id, userId, updatedAt },
        data: documentColumns(parsed.document),
        select: { updatedAt: true },
      });
      return { projectId: project.id, document: parsed.document, updatedAt: saved.updatedAt };
    });
  } catch (error) {
    // Saved or deleted elsewhere since the check; the transaction was rolled back.
    if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025")) {
      throw error;
    }
    const exists = await db.project.count({ where: { id: projectId, userId } });
    return { error: exists ? CONFLICT : NOT_FOUND };
  }
  if ("error" in result) return result;
  const { projectId: restoredId, ...restored } = result;
  return { ...restored, versions: await listVersions(userId, restoredId) };
}

/**
 * Creates a project from version `id` and opens it, named "<project>
 * (<label>)": the version's label, or `dateLabel` (its date as the user sees
 * it, read like a label) for an unlabelled one. Only errors come back.
 */
export async function openVersionAsProject(id: string, dateLabel: string): Promise<ActionResult> {
  const userId = await getUserId();
  if (!userId) return { error: SIGNED_OUT };
  const versionId = parseProjectId(id);
  if (!versionId) return { error: VERSION_NOT_FOUND };

  const version = await db.projectVersion.findFirst({
    where: { id: versionId, project: { userId } },
    select: { label: true, document: true, project: { select: { id: true, name: true } } },
  });
  if (!version) return { error: VERSION_NOT_FOUND };
  const parsed = parseStoredDocument(version.document, "This version can't be opened");
  if (parsed.error !== undefined) return { error: parsed.error };
  const date = parseVersionLabel(dateLabel);
  const label = version.label ?? (date.success ? date.data : null);
  // The project name is cut, not the label, so the parentheses stay balanced.
  const suffix = label === null ? "" : ` (${truncate(label, PROJECT_NAME_MAX - 4)})`;
  const name = parseName(
    truncate(version.project.name, PROJECT_NAME_MAX - suffix.length).trimEnd() + suffix,
  );

  const meshes = [...new Set(parsed.document.models.map(({ sha256 }) => sha256))];
  if (meshes.length > 0) {
    if (!isStorageConfigured())
      return { error: "This version has 3D models, which this server can't store." };
    if ((await missingAssets(userId, version.project.id, meshes)).length > 0) {
      return { error: `This version can't be opened: ${MESH_MISSING}` };
    }
  }

  const { id: projectId } = await db.project.create({
    data: {
      userId,
      name: name.success ? name.data : version.project.name,
      ...documentColumns(parsed.document),
    },
    select: { id: true },
  });
  // Projects never share objects (ADR-0029): the new one gets copies.
  const error = await copyMeshes(userId, version.project.id, projectId, meshes);
  if (error) return { error };
  revalidatePath("/projects");
  redirect(`/projects/${projectId}`);
}

/**
 * Copies the meshes `sha256s` of project `from` to the new project `to`. If
 * that fails, `to` is deleted with its objects and an error comes back.
 */
async function copyMeshes(
  userId: string,
  from: string,
  to: string,
  sha256s: readonly string[],
): Promise<string | undefined> {
  try {
    await copyAssets(userId, from, to, sha256s);
  } catch (error) {
    console.error(`Couldn't copy the meshes of project ${from}`, error);
    await db.project.deleteMany({ where: { id: to, userId } });
    await deleteProjectObjects(userId, to);
    return "The 3D models couldn't be copied. Try again.";
  }
}
