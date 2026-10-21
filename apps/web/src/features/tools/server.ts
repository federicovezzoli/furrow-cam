import "server-only";
import { Tool } from "@furrow/document";
import type { SavedTool, ToolChoice, ToolFormErrors } from "@furrow/workspace/lib/workspace-host";
import { DEFAULT_TOOL, parseToolForm } from "@furrow/workspace/tools/lib/tool-form-data";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { translate } from "@/lib/locale";

export type { SavedTool, ToolChoice, ToolFormErrors };
export { DEFAULT_TOOL, parseToolForm };

/** The signed-in user's tool library, by name. */
export function listTools(userId: string) {
  return db.tool.findMany({ where: { userId }, orderBy: { name: "asc" } });
}

/** One of the user's tools, or `null` if it doesn't exist or belongs to someone else. */
export function getTool(userId: string, id: string) {
  return db.tool.findFirst({ where: { id, userId } });
}

/**
 * Copies a library tool into the shape stored in an operation (ADR-0003). The
 * snapshot keeps no link to the row, so editing or deleting the tool later
 * never changes existing projects.
 */
export function snapshotTool(row: Tool): Tool {
  return Tool.parse(row);
}

/** Like `snapshotTool`, but `null` for a row that fails today's rules instead of throwing. */
export function safeSnapshotTool(row: Tool): Tool | null {
  const tool = Tool.safeParse(row);
  return tool.success ? tool.data : null;
}

/** A library tool offered when picking an operation's tool, as the snapshot to store. */

/**
 * The user's tools as snapshots for operations, by name. Rows that fail
 * today's rules are left out until they are fixed in the library.
 */
export async function listToolChoices(userId: string): Promise<ToolChoice[]> {
  const rows = await listTools(userId);
  return rows.flatMap((row) => {
    const tool = safeSnapshotTool(row);
    return tool ? [{ id: row.id, isDefault: row.isDefault, tool }] : [];
  });
}

/** Seeds the account's library with `DEFAULT_TOOL`, selected as the default tool. */
export async function createDefaultTool(userId: string): Promise<void> {
  await db.tool.create({ data: { ...DEFAULT_TOOL, userId, isDefault: true } });
}

/**
 * Locks the user's row until the transaction ends, so changes to one library
 * run one at a time and the one-default-per-user index can't be raced.
 */
export async function lockLibrary(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  await tx.$queryRaw`SELECT 1 FROM "user" WHERE "id" = ${userId} FOR UPDATE`;
}

/** Why a bit can't be changed, in the request's language. */
export const toolNotFound = () => translate("Tools.notFound");

/**
 * Creates the user's tool, or updates it when `id` is given. A user's first
 * tool becomes their default. Returns the saved tool's id and the tool as an
 * operation snapshot.
 */
export async function writeTool(
  userId: string,
  id: string | null,
  form: FormData,
): Promise<{ errors: ToolFormErrors } | SavedTool> {
  const parsed = parseToolForm(form);
  if (parsed.errors) return { errors: parsed.errors };
  const { tool } = parsed;

  if (id === null) {
    const created = await db.$transaction(async (tx) => {
      await lockLibrary(tx, userId);
      const hasDefault = await tx.tool.count({ where: { userId, isDefault: true } });
      return tx.tool.create({ data: { ...tool, userId, isDefault: hasDefault === 0 } });
    });
    return { id: created.id, tool };
  }
  const toolId = z.uuid().safeParse(id);
  if (!toolId.success) return { errors: { form: await toolNotFound() } };
  const { count } = await db.tool.updateMany({ where: { id: toolId.data, userId }, data: tool });
  if (count === 0) return { errors: { form: await toolNotFound() } };
  return { id: toolId.data, tool };
}
