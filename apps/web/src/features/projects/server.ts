import "server-only";
import {
  CURRENT_SCHEMA_VERSION,
  issueMessage,
  type Machine,
  Name,
  type ProjectDocument,
  ProjectDocumentTooNewError,
  readProjectJson,
} from "@furrow/document";
import { formatMessage, type Translator } from "@furrow/ui/lib/i18n";
import { VERSION_LABEL_MAX } from "@furrow/workspace/lib/versions";
import type { VersionRow } from "@furrow/workspace/lib/workspace-host";
import { z } from "zod";
import { getMachine, snapshotMachine } from "@/features/machines/server";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { getTranslator, translate } from "@/lib/locale";

export type { VersionRow };

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
  return { ...project, ...parseStoredDocument(document, "cantOpen", await getTranslator()) };
}

/**
 * A stored document (a project's or a version's), upgraded to the current
 * schema version and validated, or why it can't be, in `t`'s language:
 * `failure` starts the message.
 */
export function parseStoredDocument(
  json: unknown,
  failure: "cantOpen" | "cantRestore" | "cantOpenVersion",
  t: Translator,
): { document: ProjectDocument; error?: never } | { document?: never; error: string } {
  const fail = (reason: string) => ({
    error: t("Projects.failure", { failure: t(`Projects.${failure}`), reason }),
  });
  const read = readProjectJson(json);
  switch (read.reason) {
    case undefined:
      return { document: read.document };
    case "too_new":
      return fail(savedByNewerRelease(read.error, t));
    // e.g. a missing migration.
    case "version":
      return fail(formatMessage(t, read.error.detail));
    default:
      return fail(t("Projects.contentsInvalid"));
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
  .max(VERSION_LABEL_MAX)
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
  const t = await getTranslator();
  return rows.map(({ schemaVersion, ...version }) =>
    schemaVersion > CURRENT_SCHEMA_VERSION
      ? {
          ...version,
          error: t("Projects.failure", {
            failure: t("Projects.cantRestore"),
            reason: savedByNewerRelease(
              new ProjectDocumentTooNewError(schemaVersion, CURRENT_SCHEMA_VERSION),
              t,
            ),
          }),
        }
      : version,
  );
}

function savedByNewerRelease(error: ProjectDocumentTooNewError, t: Translator) {
  return t("Projects.savedByNewer", { version: error.version, supported: error.supportedVersion });
}

/** Validation issues shown for an invalid file; the rest are counted, not listed. */
const MAX_LISTED_ISSUES = 5;

/**
 * Reads an exported project file (ADR-0003): upgrades it to the current
 * schema version and validates it, or explains why it can't be imported.
 */
export function parseProjectFile(
  contents: string,
  t: Translator,
): { document: ProjectDocument; error?: never } | { error: string } {
  const read = readProjectJson(contents);
  switch (read.reason) {
    case undefined:
      return { document: read.document };
    case "not_a_project":
      return { error: t("Projects.notAProject") };
    case "too_new":
      return {
        error: t("Projects.fileCantImport", { reason: savedByNewerRelease(read.error, t) }),
      };
    case "version":
      return {
        error: t("Projects.fileCantImport", { reason: formatMessage(t, read.error.detail) }),
      };
    case "invalid": {
      const { issues } = read.error;
      const listed = listIssues(issues.slice(0, MAX_LISTED_ISSUES), t);
      const more = issues.length - MAX_LISTED_ISSUES;
      const issuesText =
        more > 0 ? `${listed}\n${t("Projects.moreProblems", { count: more })}` : listed;
      return { error: t("Projects.invalidProject", { issues: issuesText }) };
    }
  }
}

/** Validation issues in `t`'s language, one per line with where they are (ADR-0054). */
export function listIssues(issues: readonly z.core.$ZodIssue[], t: Translator): string {
  return issues
    .map((issue) => {
      const message = formatMessage(t, issueMessage(issue));
      return issue.path.length > 0 ? `✖ ${message} → ${issue.path.join(".")}` : `✖ ${message}`;
    })
    .join("\n");
}

export const PROJECT_NAME_MAX = 100;
const ProjectName = Name.max(PROJECT_NAME_MAX);

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
  if (typeof id !== "string" || id === "")
    return { error: await translate("Projects.chooseMachine") };
  const row = await getMachine(userId, id);
  if (!row) return { error: await translate("Projects.machineNotFound") };
  const machine = snapshotMachine(row);
  if (!machine) return { error: await translate("Projects.machineInvalid") };
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
