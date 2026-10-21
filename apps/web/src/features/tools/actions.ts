"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getUserId } from "@/features/auth/server";
import { db } from "@/lib/db";
import { type ActionResult, signedOut } from "@/lib/form-data";
import {
  lockLibrary,
  type SavedTool,
  type ToolFormErrors,
  toolNotFound,
  writeTool,
} from "./server";

export type { SavedTool, ToolFormErrors } from "./server";

/**
 * Creates a tool. A user's first tool becomes their default. Returns its id
 * and the saved tool as an operation snapshot (ADR-0003).
 */
export async function createTool(form: FormData): Promise<{ errors: ToolFormErrors } | SavedTool> {
  const userId = await getUserId();
  if (!userId) return { errors: { form: await signedOut() } };
  const result = await writeTool(userId, null, form);
  if ("tool" in result) revalidatePath("/tools");
  return result;
}

/**
 * Updates the tool `id`. Returns the saved tool as an operation snapshot
 * (ADR-0003), e.g. for the workspace to re-snapshot its operations.
 */
export async function updateTool(
  id: string,
  form: FormData,
): Promise<{ errors: ToolFormErrors } | SavedTool> {
  const userId = await getUserId();
  if (!userId) return { errors: { form: await signedOut() } };
  const result = await writeTool(userId, id, form);
  if ("tool" in result) revalidatePath("/tools");
  return result;
}

/** Deletes a tool. Deleting the default makes the first remaining tool, by name, the default. */
export async function deleteTool(id: string): Promise<ActionResult> {
  const userId = await getUserId();
  if (!userId) return { error: await signedOut() };
  const toolId = z.uuid().safeParse(id);
  if (!toolId.success) return { error: await toolNotFound() };

  const result = await db.$transaction(async (tx) => {
    await lockLibrary(tx, userId);
    const tool = await tx.tool.findFirst({ where: { id: toolId.data, userId } });
    if (!tool) return { error: await toolNotFound() };
    await tx.tool.delete({ where: { id: tool.id } });
    if (tool.isDefault) {
      const next = await tx.tool.findFirst({ where: { userId }, orderBy: { name: "asc" } });
      if (next) await tx.tool.update({ where: { id: next.id }, data: { isDefault: true } });
    }
  });
  revalidatePath("/tools");
  return result;
}

/** Makes `id` the tool preselected for new operations, replacing the previous default. */
export async function setDefaultTool(id: string): Promise<ActionResult> {
  const userId = await getUserId();
  if (!userId) return { error: await signedOut() };
  const toolId = z.uuid().safeParse(id);
  if (!toolId.success) return { error: await toolNotFound() };

  const result = await db.$transaction(async (tx) => {
    await lockLibrary(tx, userId);
    if (!(await tx.tool.findFirst({ where: { id: toolId.data, userId } }))) {
      return { error: await toolNotFound() };
    }
    // Clear first: the database allows at most one default per user.
    await tx.tool.updateMany({ where: { userId, isDefault: true }, data: { isDefault: false } });
    await tx.tool.update({ where: { id: toolId.data }, data: { isDefault: true } });
  });
  revalidatePath("/tools");
  return result;
}
