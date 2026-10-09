import {
  type ProjectDocument,
  ProjectDocumentTooNewError,
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
    if (error instanceof ProjectDocumentTooNewError) {
      return { ...project, error: `This project can't be opened: ${savedByNewerRelease(error)}` };
    }
    // e.g. a missing migration.
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

function savedByNewerRelease(error: ProjectDocumentTooNewError) {
  return `it was saved by a newer version of Furrow CAM (document version ${error.version}; this version reads up to ${error.supportedVersion}).`;
}

/** Validation issues shown for an invalid file; the rest are counted, not listed. */
const MAX_LISTED_ISSUES = 5;

/**
 * Reads an exported project file (ADR-0003): upgrades it to the current
 * schema version and validates it, or explains why it can't be imported.
 */
export function parseProjectFile(
  contents: string,
): { document: ProjectDocument; error?: never } | { error: string } {
  const NOT_A_PROJECT = "This file isn't a Furrow CAM project.";
  let json: unknown;
  try {
    json = JSON.parse(contents);
  } catch {
    return { error: NOT_A_PROJECT };
  }
  // Any other JSON file (`package.json`, `[]`, …) would otherwise fail on its missing `schemaVersion`.
  if (typeof json !== "object" || json === null || !("schemaVersion" in json)) {
    return { error: NOT_A_PROJECT };
  }

  try {
    return { document: parseProjectDocument(json) };
  } catch (error) {
    if (error instanceof ProjectDocumentTooNewError) {
      return { error: `This file can't be imported: ${savedByNewerRelease(error)}` };
    }
    if (error instanceof ProjectDocumentVersionError) {
      return { error: `This file can't be imported: ${error.message}.` };
    }
    if (error instanceof z.ZodError) {
      const { issues } = error;
      const listed = z.prettifyError(new z.ZodError(issues.slice(0, MAX_LISTED_ISSUES)));
      const more = issues.length - MAX_LISTED_ISSUES;
      return {
        error: `This file isn't a valid Furrow CAM project: ${listed}${more > 0 ? `\n…and ${more} more problems.` : ""}`,
      };
    }
    throw error;
  }
}
