import "server-only";
import { Tool } from "@furrow/document";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { type FormErrors, issuesToFormErrors, numberField } from "@/lib/form-data";
import { limitError } from "@/lib/limits";
import { TOOL_COLORS } from "./lib/colors";

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
export type ToolChoice = { id: string; isDefault: boolean; tool: Tool };

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

/** Seeded into every new account, so a first project can be cut without setting up a library. */
export const DEFAULT_TOOL: Tool = Tool.parse({
  name: "6 mm 2-flute upcut",
  type: "flat_end_mill",
  diameter: 6,
  fluteCount: 2,
  fluteLength: 22,
  cutDirection: "upcut",
  vAngle: null,
  tipDiameter: null,
  spindleRpm: 24000,
  feedRate: 600,
  plungeRate: 300,
  plungeAngle: 3,
  stepDown: 1,
  stepOver: 40,
  notes: null,
  color: TOOL_COLORS[0],
});

/**
 * Seeds the account's library with `DEFAULT_TOOL`, selected as the default
 * tool. Never limited (PRD-0003 F5): limits are at least 1.
 */
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

/**
 * Reads the tool form. Fields that don't apply to the chosen type are ignored,
 * so switching type in the form never leaves stale values behind.
 */
export function parseToolForm(form: FormData) {
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
    plungeAngle: type === "drill" ? 90 : numberField(form, "plungeAngle"),
    stepDown: numberField(form, "stepDown"),
    stepOver: numberField(form, "stepOver"),
    notes: notes === "" ? null : notes,
    color: String(form.get("color") ?? "").toLowerCase(),
  };
  const result = Tool.safeParse(input);
  if (result.success) return { tool: result.data };

  return { errors: issuesToFormErrors<keyof Tool>(result.error.issues, input) };
}

export type ToolFormErrors = FormErrors<keyof Tool>;

/** A tool the form saved: its library id, and the tool as an operation snapshot. */
export type SavedTool = { id: string; tool: Tool };

export const TOOL_NOT_FOUND = "This bit no longer exists.";

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
      const error = await limitError(tx, userId, "tools");
      if (error) return { error };
      const hasDefault = await tx.tool.count({ where: { userId, isDefault: true } });
      return tx.tool.create({ data: { ...tool, userId, isDefault: hasDefault === 0 } });
    });
    if ("error" in created) return { errors: { form: created.error } };
    return { id: created.id, tool };
  }
  const toolId = z.uuid().safeParse(id);
  if (!toolId.success) return { errors: { form: TOOL_NOT_FOUND } };
  const { count } = await db.tool.updateMany({ where: { id: toolId.data, userId }, data: tool });
  if (count === 0) return { errors: { form: TOOL_NOT_FOUND } };
  return { id: toolId.data, tool };
}
