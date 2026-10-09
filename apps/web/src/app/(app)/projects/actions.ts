"use server";

import {
  createProjectDocument,
  Name,
  ProjectDocument,
  projectNameFromFileName,
} from "@furrow/document";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { type ActionResult, type FormErrors, SIGNED_OUT } from "@/lib/form-data";
import { documentColumns, getProject, parseProjectFile, parseProjectId } from "@/lib/projects";
import { getUserId } from "@/lib/session";

export type ProjectFormErrors = FormErrors<"name">;

const NOT_FOUND = "This project no longer exists.";
const CONFLICT =
  "This project was changed somewhere else since you opened it. Reload it to see the latest version.";

const PROJECT_NAME_MAX = 100;
const ProjectName = Name.max(PROJECT_NAME_MAX, `Must be at most ${PROJECT_NAME_MAX} characters`);

/** Reads a name typed by the user; surrounding spaces are dropped. */
function parseName(value: unknown) {
  return ProjectName.safeParse(typeof value === "string" ? value.trim() : "");
}

/** Creates an empty project and opens it. */
export async function createProject(form: FormData): Promise<ProjectFormErrors> {
  const userId = await getUserId();
  if (!userId) return { form: SIGNED_OUT };
  const name = parseName(form.get("name"));
  if (!name.success) return { name: name.error.issues[0]?.message };

  const { id } = await db.project.create({
    data: { userId, name: name.data, ...documentColumns(createProjectDocument()) },
    select: { id: true },
  });
  revalidatePath("/projects");
  redirect(`/projects/${id}`);
}

/**
 * Creates a project from an exported file and opens it. The file is upgraded
 * to the current schema version and validated; the name comes from the file
 * name. Only errors come back.
 */
export async function importProject(fileName: string, contents: string): Promise<ActionResult> {
  const userId = await getUserId();
  if (!userId) return { error: SIGNED_OUT };
  const parsed = parseProjectFile(contents);
  if (parsed.error !== undefined) return { error: parsed.error };
  let fileBaseName = (projectNameFromFileName(fileName) ?? "").slice(0, PROJECT_NAME_MAX);
  // Don't leave half an emoji at the cut.
  if (/[\uD800-\uDBFF]$/.test(fileBaseName)) fileBaseName = fileBaseName.slice(0, -1);
  const name = parseName(fileBaseName);

  const { id } = await db.project.create({
    data: {
      userId,
      name: name.success ? name.data : "Imported project",
      ...documentColumns(parsed.document),
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
