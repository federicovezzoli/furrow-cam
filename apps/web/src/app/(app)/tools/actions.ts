"use server";

import { Tool } from "@furrow/document";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { listTools as listUserTools } from "@/lib/tools";

/** Field name → message; `form` holds errors that aren't about one field. */
export type ToolFormErrors = Partial<Record<keyof Tool | "form", string>>;

async function requireUserId(): Promise<string> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Unauthorized");
  return session.user.id;
}

function numberField(form: FormData, key: string): number | null {
  const value = form.get(key);
  if (typeof value !== "string" || value.trim() === "") return null;
  return Number(value);
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
  };
  const result = Tool.safeParse(input);
  if (result.success) return { tool: result.data };

  const errors: ToolFormErrors = {};
  for (const issue of result.error.issues) {
    const key = (issue.path[0] ?? "form") as keyof ToolFormErrors;
    const missing = issue.code === "invalid_type" && input[key as keyof typeof input] == null;
    errors[key] ??= missing ? "Required" : issue.message;
  }
  return { errors };
}

export async function listTools() {
  return listUserTools(await requireUserId());
}

/** Creates a tool, or updates it when `id` is given. Redirects to the library on success. */
export async function saveTool(id: string | null, form: FormData): Promise<ToolFormErrors> {
  const userId = await requireUserId();
  const parsed = parseToolForm(form);
  if (parsed.errors) return parsed.errors;
  const { tool } = parsed;

  if (id === null) {
    await db.tool.create({ data: { ...tool, userId } });
  } else {
    const { count } = await db.tool.updateMany({
      where: { id: z.uuid().parse(id), userId },
      data: tool,
    });
    if (count === 0) return { form: "This tool no longer exists." };
  }
  revalidatePath("/tools");
  redirect("/tools");
}

export async function deleteTool(id: string): Promise<void> {
  const userId = await requireUserId();
  await db.tool.deleteMany({ where: { id: z.uuid().parse(id), userId } });
  revalidatePath("/tools");
}
