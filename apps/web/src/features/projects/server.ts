import "server-only";
import {
  CURRENT_SCHEMA_VERSION,
  type Machine,
  Name,
  type ProjectDocument,
  ProjectDocumentTooNewError,
  ProjectDocumentVersionError,
  parseProjectDocument,
} from "@furrow/document";
import { z } from "zod";
import { getMachine, snapshotMachine } from "@/features/machines/server";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { VERSION_LABEL_MAX } from "./lib/versions";

/**
 * Locks the project's row until the transaction ends, so writes that check
 * its versions or assets first happen one at a time.
 */
export async function lockProject(tx: Prisma.TransactionClient, projectId: string) {
  await tx.$executeRaw`SELECT 1 FROM "project" WHERE "id" = ${projectId} FOR UPDATE`;
}

/** A project id from the URL or the client, or `null` if it can't be one. */
export function parseProjectId(id: unknown): string | null {
  const result = z.uuid().safeParse(id);
  return result.success ? result.data : null;
}

/**
 * The signed-in user's projects, most recently saved first, with their
 * machine's name (`null` without one). Documents are left out.
 */
export function listProjects(userId: string) {
  return db.project.findMany({
    where: { userId },
    select: { id: true, name: true, machineName: true, createdAt: true, updatedAt: true },
    orderBy: { updatedAt: "desc" },
  });
}

export type ProjectListRow = Awaited<ReturnType<typeof listProjects>>[number];

export type ProjectRow = { id: string; name: string; updatedAt: Date };

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
  return { ...project, ...parseStoredDocument(document, "This project can't be opened") };
}

/**
 * A stored document (a project's or a version's), upgraded to the current
 * schema version and validated, or why it can't be: `failure` starts the message.
 */
export function parseStoredDocument(
  json: unknown,
  failure: string,
): { document: ProjectDocument; error?: never } | { document?: never; error: string } {
  try {
    return { document: parseProjectDocument(json) };
  } catch (error) {
    if (error instanceof ProjectDocumentTooNewError) {
      return { error: `${failure}: ${savedByNewerRelease(error)}` };
    }
    // e.g. a missing migration.
    if (error instanceof ProjectDocumentVersionError) {
      return { error: `${failure}: ${error.message}.` };
    }
    if (error instanceof z.ZodError) {
      return { error: `${failure}: its contents are invalid.` };
    }
    throw error;
  }
}

/** The columns that store a validated document (ADR-0003), with the copies kept of its fields. */
export function documentColumns(document: ProjectDocument) {
  return {
    schemaVersion: document.schemaVersion,
    machineName: document.machine?.name ?? null,
    document: document as Prisma.InputJsonObject,
  };
}

const VersionLabel = z
  .string()
  .trim()
  .max(VERSION_LABEL_MAX, `Must be at most ${VERSION_LABEL_MAX} characters`)
  .transform((label) => label || null);

/** Reads a version label typed by the user: `null` when it's left blank. */
export function parseVersionLabel(value: unknown) {
  return VersionLabel.safeParse(typeof value === "string" ? value : "");
}

/**
 * The versions of the user's project `projectId`, newest first (none if it
 * isn't theirs). Documents are left out; `error` says why a version saved by
 * a newer release can't be restored.
 */
export async function listVersions(userId: string, projectId: string): Promise<VersionRow[]> {
  const rows = await db.projectVersion.findMany({
    where: { projectId, project: { userId } },
    select: { id: true, label: true, schemaVersion: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(({ schemaVersion, ...version }) =>
    schemaVersion > CURRENT_SCHEMA_VERSION
      ? {
          ...version,
          error: `This version can't be restored: ${savedByNewerRelease(
            new ProjectDocumentTooNewError(schemaVersion, CURRENT_SCHEMA_VERSION),
          )}`,
        }
      : version,
  );
}

export type VersionRow = { id: string; label: string | null; createdAt: Date; error?: string };

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

export const PROJECT_NAME_MAX = 100;
const ProjectName = Name.max(PROJECT_NAME_MAX, `Must be at most ${PROJECT_NAME_MAX} characters`);

/** Reads a name typed by the user; surrounding spaces are dropped. */
export function parseName(value: unknown) {
  return ProjectName.safeParse(typeof value === "string" ? value.trim() : "");
}

/**
 * A snapshot of the user's machine `id` for a project (ADR-0003), or why
 * there is none: the id is missing, or the machine doesn't exist or belongs
 * to someone else.
 */
export async function snapshotUserMachine(
  userId: string,
  id: unknown,
): Promise<{ machine: Machine; error?: never } | { error: string }> {
  if (typeof id !== "string" || id === "") return { error: "Choose a machine." };
  const row = await getMachine(userId, id);
  if (!row) return { error: "This machine no longer exists." };
  const machine = snapshotMachine(row);
  if (!machine) {
    return { error: "This machine's settings are no longer valid. Fix them on the Machines page." };
  }
  return { machine };
}

/** `text` cut to at most `max` UTF-16 units, without splitting a character. */
export function truncate(text: string, max: number) {
  let result = "";
  for (const char of text) {
    if (result.length + char.length > max) break;
    result += char;
  }
  return result;
}
