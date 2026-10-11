"use server";

import { Machine } from "@furrow/document";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  type ActionResult,
  type FormErrors,
  issuesToFormErrors,
  numberField,
  SIGNED_OUT,
} from "@/lib/form-data";
import { getUserId } from "@/lib/session";

export type MachineFormErrors = FormErrors<keyof Machine>;

const NOT_FOUND = "This machine no longer exists.";

/** Blank text keeps the post-processor's default. */
function gcodeField(form: FormData, key: string): string | null {
  const value = form.get(key);
  // Browsers submit textarea line breaks as CRLF; G-code files use LF.
  const text = typeof value === "string" ? value.replace(/\r\n?/g, "\n").trimEnd() : "";
  return text.trim() === "" ? null : text;
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

  // A blank spindle speed reads "Required" unless the spindle is manual.
  return { errors: issuesToFormErrors<keyof Machine>(result.error.issues, input) };
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
