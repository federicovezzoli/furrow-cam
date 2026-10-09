"use server";

import { createProjectDocument, Name, ProjectDocument } from "@furrow/document";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { type ActionResult, type FormErrors, SIGNED_OUT } from "@/lib/form-data";
import { documentColumns, getProject, listProjects } from "@/lib/projects";
import { getUserId } from "@/lib/session";

export type ProjectFormErrors = FormErrors<"name">;

const NOT_FOUND = "This project no longer exists.";

/** Reads a name typed by the user; surrounding spaces are dropped. */
function parseName(value: unknown) {
  return Name.safeParse(typeof value === "string" ? value.trim() : "");
}

/** The signed-in user's projects, most recently saved first. */
export async function getProjects() {
  const userId = await getUserId();
  if (!userId) return { error: SIGNED_OUT };
  return { projects: await listProjects(userId) };
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

export async function renameProject(id: string, name: string): Promise<ActionResult> {
  const userId = await getUserId();
  if (!userId) return { error: SIGNED_OUT };
  const projectId = z.uuid().safeParse(id);
  if (!projectId.success) return { error: NOT_FOUND };
  const parsed = parseName(name);
  if (!parsed.success) return { error: `Name: ${parsed.error.issues[0]?.message}` };

  const { count } = await db.project.updateMany({
    where: { id: projectId.data, userId },
    data: { name: parsed.data },
  });
  revalidatePath("/projects");
  if (count === 0) return { error: NOT_FOUND };
}

export async function deleteProject(id: string): Promise<ActionResult> {
  const userId = await getUserId();
  if (!userId) return { error: SIGNED_OUT };
  const projectId = z.uuid().safeParse(id);
  if (!projectId.success) return { error: NOT_FOUND };

  const { count } = await db.project.deleteMany({ where: { id: projectId.data, userId } });
  revalidatePath("/projects");
  if (count === 0) return { error: NOT_FOUND };
}

/** A project's name and document, upgraded to the current schema version. */
export async function loadProject(id: string) {
  const userId = await getUserId();
  if (!userId) return { error: SIGNED_OUT };
  const projectId = z.uuid().safeParse(id);
  const project = projectId.success ? await getProject(userId, projectId.data) : null;
  if (!project) return { error: NOT_FOUND };
  return { project };
}

/**
 * Replaces a project's document. It must be valid for the current schema
 * version: the client always edits upgraded documents, so older versions are
 * rejected rather than migrated (ADR-0003).
 */
export async function saveProject(id: string, document: unknown): Promise<ActionResult> {
  const userId = await getUserId();
  if (!userId) return { error: SIGNED_OUT };
  const projectId = z.uuid().safeParse(id);
  if (!projectId.success) return { error: NOT_FOUND };
  const parsed = ProjectDocument.safeParse(document);
  if (!parsed.success) {
    return { error: `The project couldn't be saved: ${z.prettifyError(parsed.error)}` };
  }

  const { count } = await db.project.updateMany({
    where: { id: projectId.data, userId },
    data: documentColumns(parsed.data),
  });
  revalidatePath("/projects");
  if (count === 0) return { error: NOT_FOUND };
}
