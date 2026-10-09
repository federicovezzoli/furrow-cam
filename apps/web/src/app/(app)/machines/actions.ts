"use server";

import { Machine } from "@furrow/document";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { getUserId } from "@/lib/session";

/** Field name → message; `form` holds errors that aren't about one field. */
export type MachineFormErrors = Partial<Record<keyof Machine | "form", string>>;

/** `undefined` on success, or a message to show the user. Unexpected failures still throw. */
export type ActionResult = { error: string } | undefined;

const SIGNED_OUT = "Your session has expired. Sign in again.";
const NOT_FOUND = "This machine no longer exists.";

/** Blank text keeps the post-processor's default. */
function gcodeField(form: FormData, key: string): string | null {
  const value = form.get(key);
  // Browsers submit textarea line breaks as CRLF; G-code files use LF.
  const text = typeof value === "string" ? value.replace(/\r\n?/g, "\n").trimEnd() : "";
  return text.trim() === "" ? null : text;
}

function numberField(form: FormData, key: string): number | null {
  const value = form.get(key);
  if (typeof value !== "string" || value.trim() === "") return null;
  return Number(value);
}

/**
 * Reads the machine form. A manual spindle ignores the speed fields, so
 * ticking it never leaves stale values behind.
 */
function parseMachineForm(form: FormData) {
  const manualSpindle = form.get("manualSpindle") === "on";
  const input = {
    name: String(form.get("name") ?? ""),
    workAreaX: numberField(form, "workAreaX"),
    workAreaY: numberField(form, "workAreaY"),
    workAreaZ: numberField(form, "workAreaZ"),
    maxFeedXY: numberField(form, "maxFeedXY"),
    maxFeedZ: numberField(form, "maxFeedZ"),
    spindleRpmMin: manualSpindle ? null : numberField(form, "spindleRpmMin"),
    spindleRpmMax: manualSpindle ? null : numberField(form, "spindleRpmMax"),
    safeZ: numberField(form, "safeZ"),
    postProcessor: form.get("postProcessor"),
    programStart: gcodeField(form, "programStart"),
    programEnd: gcodeField(form, "programEnd"),
    operationStart: gcodeField(form, "operationStart"),
    toolChange: gcodeField(form, "toolChange"),
  };
  const result = Machine.safeParse(input);
  if (result.success) return { machine: result.data };

  const errors: MachineFormErrors = {};
  for (const issue of result.error.issues) {
    const key = (issue.path[0] ?? "form") as keyof MachineFormErrors;
    // Includes a blank spindle speed when the spindle isn't manual.
    const missing = input[key as keyof typeof input] == null;
    errors[key] ??= missing ? "Required" : issue.message;
  }
  return { errors };
}

/** Creates a machine, or updates it when `id` is given. Redirects to the list on success. */
export async function saveMachine(id: string | null, form: FormData): Promise<MachineFormErrors> {
  const userId = await getUserId();
  if (!userId) return { form: SIGNED_OUT };
  const parsed = parseMachineForm(form);
  if (parsed.errors) return parsed.errors;
  const { machine } = parsed;

  if (id === null) {
    await db.machine.create({ data: { ...machine, userId } });
  } else {
    const machineId = z.uuid().safeParse(id);
    if (!machineId.success) return { form: NOT_FOUND };
    const { count } = await db.machine.updateMany({
      where: { id: machineId.data, userId },
      data: machine,
    });
    if (count === 0) return { form: NOT_FOUND };
  }
  revalidatePath("/machines");
  redirect("/machines");
}

/** Deletes a machine. Projects keep their own snapshot of it (ADR-0003). */
export async function deleteMachine(id: string): Promise<ActionResult> {
  const userId = await getUserId();
  if (!userId) return { error: SIGNED_OUT };
  const machineId = z.uuid().safeParse(id);
  if (!machineId.success) return { error: NOT_FOUND };

  const { count } = await db.machine.deleteMany({ where: { id: machineId.data, userId } });
  revalidatePath("/machines");
  if (count === 0) return { error: NOT_FOUND };
}
