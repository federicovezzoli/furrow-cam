"use server";

import type { Machine } from "@furrow/document";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getUserId } from "@/features/auth/server";
import { db } from "@/lib/db";
import { type ActionResult, type FormErrors, signedOut } from "@/lib/form-data";
import { translate } from "@/lib/locale";
import { parseMachineForm } from "./server";

export type MachineFormErrors = FormErrors<keyof Machine>;

const notFound = () => translate("Machines.notFound");

/**
 * Creates a machine and redirects to the list, or updates it when `id` is
 * given and stays on its page.
 */
export async function saveMachine(id: string | null, form: FormData): Promise<MachineFormErrors> {
  const userId = await getUserId();
  if (!userId) return { form: await signedOut() };
  const parsed = parseMachineForm(form);
  if (parsed.errors) return parsed.errors;
  const { machine } = parsed;

  if (id === null) {
    await db.machine.create({ data: { ...machine, userId } });
  } else {
    const machineId = z.uuid().safeParse(id);
    if (!machineId.success) return { form: await notFound() };
    const { count } = await db.machine.updateMany({
      where: { id: machineId.data, userId },
      data: machine,
    });
    if (count === 0) return { form: await notFound() };
  }
  // The machine list, the new-project options and every project's machine picker.
  revalidatePath("/", "layout");
  if (id === null) redirect("/machines");
  return {};
}

/** Deletes a machine. Projects keep their own snapshot of it (ADR-0003). */
export async function deleteMachine(id: string): Promise<ActionResult> {
  const userId = await getUserId();
  if (!userId) return { error: await signedOut() };
  const machineId = z.uuid().safeParse(id);
  if (!machineId.success) return { error: await notFound() };

  const { count } = await db.machine.deleteMany({ where: { id: machineId.data, userId } });
  revalidatePath("/", "layout");
  if (count === 0) return { error: await notFound() };
}
