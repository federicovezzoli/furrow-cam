import {
  type ProjectDocument,
  ProjectDocumentVersionError,
  parseProjectDocument,
} from "@furrow/document";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";

/** A project id from the URL or the client, or `null` if it can't be one. */
export function parseProjectId(id: unknown): string | null {
  const result = z.uuid().safeParse(id);
  return result.success ? result.data : null;
}

/** The signed-in user's projects, most recently saved first. Documents are left out. */
export function listProjects(userId: string) {
  return db.project.findMany({
    where: { userId },
    select: { id: true, name: true, createdAt: true, updatedAt: true },
    orderBy: { updatedAt: "desc" },
  });
}

type ProjectRow = { id: string; name: string; updatedAt: Date };

/**
 * One of the user's projects, or `null` if `id` is malformed, doesn't exist or
 * belongs to someone else. The document is upgraded to the current version and
 * validated; if that fails, `error` explains why instead.
 */
export async function getProject(
  userId: string,
  id: string,
): Promise<
  | (ProjectRow & { document: ProjectDocument; error?: never })
  | (ProjectRow & { document?: never; error: string })
  | null
> {
  const projectId = parseProjectId(id);
  if (!projectId) return null;
  const row = await db.project.findFirst({
    where: { id: projectId, userId },
    select: { id: true, name: true, document: true, updatedAt: true },
  });
  if (!row) return null;

  const { document, ...project } = row;
  try {
    return { ...project, document: parseProjectDocument(document) };
  } catch (error) {
    // e.g. saved by a newer release before a rollback, or a missing migration.
    if (error instanceof ProjectDocumentVersionError) {
      return { ...project, error: `This project can't be opened: ${error.message}.` };
    }
    if (error instanceof z.ZodError) {
      return { ...project, error: "This project can't be opened: its contents are invalid." };
    }
    throw error;
  }
}

/** The columns that store a validated document (ADR-0003). */
export function documentColumns(document: ProjectDocument) {
  return {
    schemaVersion: document.schemaVersion,
    document: document as Prisma.InputJsonObject,
  };
}
