import { type ProjectDocument, parseProjectDocument } from "@furrow/document";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";

/** The signed-in user's projects, most recently saved first. Documents are left out. */
export function listProjects(userId: string) {
  return db.project.findMany({
    where: { userId },
    select: { id: true, name: true, createdAt: true, updatedAt: true },
    orderBy: { updatedAt: "desc" },
  });
}

/**
 * One of the user's projects with its document upgraded to the current
 * version and validated, or `null` if it doesn't exist or belongs to someone
 * else. Throws if the stored document can't be read.
 */
export async function getProject(userId: string, id: string) {
  const row = await db.project.findFirst({
    where: { id, userId },
    select: { id: true, name: true, document: true, updatedAt: true },
  });
  if (!row) return null;
  return { ...row, document: parseProjectDocument(row.document) };
}

/** The columns that store a validated document (ADR-0003). */
export function documentColumns(document: ProjectDocument) {
  return {
    schemaVersion: document.schemaVersion,
    document: document as Prisma.InputJsonObject,
  };
}
