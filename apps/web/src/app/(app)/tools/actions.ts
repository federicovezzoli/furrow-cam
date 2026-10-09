"use server";

import { Tool } from "@furrow/document";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import {
  type ActionResult,
  type FormErrors,
  issuesToFormErrors,
  numberField,
  SIGNED_OUT,
} from "@/lib/form-data";
import { getUserId } from "@/lib/session";

export type ToolFormErrors = FormErrors<keyof Tool>;

const NOT_FOUND = "This bit no longer exists.";

/**
 * Locks the user's row until the transaction ends, so changes to one library
 * run one at a time and the one-default-per-user index can't be raced.
 */
async function lockLibrary(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  await tx.$queryRaw`SELECT 1 FROM "user" WHERE "id" = ${userId} FOR UPDATE`;
}

/**
 * Reads the tool form. Fields that don't apply to the chosen type are ignored,
 * so switching type in the form never leaves stale values behind.
 */
function parseToolForm(form: FormData) {
  const type = form.get("type");
  const isEndMill = type === "flat_end_mill" || type === "ball_end_mill";
  const isVBit = type === "v_bit";
  const notes = String(form.get("notes") ?? "").trim();
  const input = {
    name: String(form.get("name") ?? ""),
    type,
    diameter: numberField(form, "diameter"),
    fluteCount: numberField(form, "fluteCount"),
    fluteLength: numberField(form, "fluteLength"),
    cutDirection: isEndMill ? (form.get("cutDirection") ?? null) : null,
    vAngle: isVBit ? numberField(form, "vAngle") : null,
    tipDiameter: isVBit ? numberField(form, "tipDiameter") : null,
    spindleRpm: numberField(form, "spindleRpm"),
    feedRate: numberField(form, "feedRate"),
    plungeRate: numberField(form, "plungeRate"),
    stepDown: numberField(form, "stepDown"),
    stepOver: numberField(form, "stepOver"),
    notes: notes === "" ? null : notes,
    color: String(form.get("color") ?? "").toLowerCase(),
  };
  const result = Tool.safeParse(input);
  if (result.success) return { tool: result.data };

  return { errors: issuesToFormErrors<keyof Tool>(result.error.issues, input) };
}

/**
 * Creates a tool, or updates it when `id` is given. A user's first tool
 * becomes their default. Redirects to the library on success.
 */
export async function saveTool(id: string | null, form: FormData): Promise<ToolFormErrors> {
  const userId = await getUserId();
  if (!userId) return { form: SIGNED_OUT };
  const parsed = parseToolForm(form);
  if (parsed.errors) return parsed.errors;
  const { tool } = parsed;

  if (id === null) {
    await db.$transaction(async (tx) => {
      await lockLibrary(tx, userId);
      const hasDefault = await tx.tool.count({ where: { userId, isDefault: true } });
      await tx.tool.create({ data: { ...tool, userId, isDefault: hasDefault === 0 } });
    });
  } else {
    const toolId = z.uuid().safeParse(id);
    if (!toolId.success) return { form: NOT_FOUND };
    const { count } = await db.tool.updateMany({ where: { id: toolId.data, userId }, data: tool });
    if (count === 0) return { form: NOT_FOUND };
  }
  revalidatePath("/tools");
  redirect("/tools");
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
