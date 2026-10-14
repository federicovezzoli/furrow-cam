"use server";

import { createProjectDocument, ProjectDocument, projectNameFromFileName } from "@furrow/document";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getUserId } from "@/features/auth/server";
import { listMachineChoices } from "@/features/machines/server";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { type ActionResult, type FormErrors, SIGNED_OUT } from "@/lib/form-data";
import {
  documentColumns,
  getProject,
  PROJECT_NAME_MAX,
  parseName,
  parseProjectFile,
  parseProjectId,
  snapshotUserMachine,
  truncate,
} from "./server";

export type ProjectFormErrors = FormErrors<"name" | "machine">;

/** What `importProject` returns: an error, or that the file needs a machine chosen first. */
export type ImportResult = ActionResult | { chooseMachine: true; error?: never };

const NOT_FOUND = "This project no longer exists.";
const CONFLICT =
  "This project was changed somewhere else since you opened it. Reload it to see the latest version.";

/** Creates an empty project for one of the user's machines and opens it. */
export async function createProject(form: FormData): Promise<ProjectFormErrors> {
  const userId = await getUserId();
  if (!userId) return { form: SIGNED_OUT };
  const name = parseName(form.get("name"));
  if (!name.success) return { name: name.error.issues[0]?.message };
  const snapshot = await snapshotUserMachine(userId, form.get("machine"));
  if (snapshot.error !== undefined) return { machine: snapshot.error };

  const document = { ...createProjectDocument(), machine: snapshot.machine };
  const { id } = await db.project.create({
    data: { userId, name: name.data, ...documentColumns(document) },
    select: { id: true },
  });
  revalidatePath("/projects");
  redirect(`/projects/${id}`);
}

/**
 * Creates a project from an exported file and opens it. The file is upgraded
 * to the current schema version and validated; the name comes from the file
 * name. A file's machine snapshot is kept; a file without one gets the
 * user's machine `machineId`, and `chooseMachine` comes back when it is
 * missing. Only errors come back otherwise.
 */
export async function importProject(file: File, machineId: string | null): Promise<ImportResult> {
  const userId = await getUserId();
  if (!userId) return { error: SIGNED_OUT };
  if (!(file instanceof File)) return { error: "Pick a file to import." };
  const parsed = parseProjectFile(await file.text());
  if (parsed.error !== undefined) return { error: parsed.error };
  let document = parsed.document;
  if (document.machine === null) {
    if (machineId === null) {
      // The machines the import dialog offers: rows that fail today's rules aren't.
      const machines = await listMachineChoices(userId);
      if (machines.length === 0) return { error: "Add a machine before importing a project." };
      return { chooseMachine: true };
    }
    const snapshot = await snapshotUserMachine(userId, machineId);
    if (snapshot.error !== undefined) return { error: snapshot.error };
    document = { ...document, machine: snapshot.machine };
  }
  const name = parseName(truncate(projectNameFromFileName(file.name) ?? "", PROJECT_NAME_MAX));

  const { id } = await db.project.create({
    data: {
      userId,
      name: name.success ? name.data : "Imported project",
      ...documentColumns(document),
    },
    select: { id: true },
  });
  revalidatePath("/projects");
  redirect(`/projects/${id}`);
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

  try {
    // No revalidation: the list is rendered per request, and autosave would invalidate it constantly.
    return await db.project.update({
      where: { id: projectId, userId, updatedAt },
      data: documentColumns(parsed.data),
      select: { updatedAt: true },
    });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025")) {
      throw error;
    }
    const exists = await db.project.count({ where: { id: projectId, userId } });
    return { error: exists ? CONFLICT : NOT_FOUND };
  }
}
