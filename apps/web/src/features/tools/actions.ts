"use server";

import type { Tool } from "@furrow/document";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getUserId } from "@/features/auth/server";
import { db } from "@/lib/db";
import { type ActionResult, type FormErrors, SIGNED_OUT } from "@/lib/form-data";
import { lockLibrary, parseToolForm } from "./server";

export type ToolFormErrors = FormErrors<keyof Tool>;

const NOT_FOUND = "This bit no longer exists.";

/** Creates a tool, or updates it when `id` is given. A user's first tool becomes their default. */
async function writeTool(
  id: string | null,
  form: FormData,
): Promise<{ errors: ToolFormErrors } | { tool: Tool }> {
  const userId = await getUserId();
  if (!userId) return { errors: { form: SIGNED_OUT } };
  const parsed = parseToolForm(form);
  if (parsed.errors) return { errors: parsed.errors };
  const { tool } = parsed;

  if (id === null) {
    await db.$transaction(async (tx) => {
      await lockLibrary(tx, userId);
      const hasDefault = await tx.tool.count({ where: { userId, isDefault: true } });
      await tx.tool.create({ data: { ...tool, userId, isDefault: hasDefault === 0 } });
    });
  } else {
    const toolId = z.uuid().safeParse(id);
    if (!toolId.success) return { errors: { form: NOT_FOUND } };
    const { count } = await db.tool.updateMany({ where: { id: toolId.data, userId }, data: tool });
    if (count === 0) return { errors: { form: NOT_FOUND } };
  }
  revalidatePath("/tools");
  return { tool };
}

/**
 * Creates a tool. A user's first tool becomes their default.
 * Returns the saved tool as an operation snapshot (ADR-0003).
 */
export async function createTool(
  form: FormData,
): Promise<{ errors: ToolFormErrors } | { tool: Tool }> {
  return writeTool(null, form);
}

/**
 * Updates the tool `id`. Returns the saved tool as an operation snapshot
 * (ADR-0003), e.g. for the workspace to re-snapshot its operations.
 */
export async function updateTool(
  id: string,
  form: FormData,
): Promise<{ errors: ToolFormErrors } | { tool: Tool }> {
  return writeTool(id, form);
}

/** Deletes a tool. Deleting the default makes the first remaining tool, by name, the default. */
export async function deleteTool(id: string): Promise<ActionResult> {
  const userId = await getUserId();
  if (!userId) return { error: SIGNED_OUT };
  const toolId = z.uuid().safeParse(id);
  if (!toolId.success) return { error: NOT_FOUND };

  const result = await db.$transaction(async (tx) => {
    await lockLibrary(tx, userId);
    const tool = await tx.tool.findFirst({ where: { id: toolId.data, userId } });
    if (!tool) return { error: NOT_FOUND };
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
  if (!userId) return { error: SIGNED_OUT };
  const toolId = z.uuid().safeParse(id);
  if (!toolId.success) return { error: NOT_FOUND };

  const result = await db.$transaction(async (tx) => {
    await lockLibrary(tx, userId);
    if (!(await tx.tool.findFirst({ where: { id: toolId.data, userId } }))) {
      return { error: NOT_FOUND };
    }
    // Clear first: the database allows at most one default per user.
    await tx.tool.updateMany({ where: { userId, isDefault: true }, data: { isDefault: false } });
    await tx.tool.update({ where: { id: toolId.data }, data: { isDefault: true } });
  });
  revalidatePath("/tools");
  return result;
}
