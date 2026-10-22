"use server";

import type { Machine } from "@furrow/document";
import type { KeyMessage } from "@furrow/ui/lib/i18n";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getUserId } from "@/features/auth/server";
import { db } from "@/lib/db";
import { type ActionResult, type FormErrors, signedOut } from "@/lib/form-data";
import { parseMachineForm } from "./server";

export type MachineFormErrors = FormErrors<keyof Machine>;

const notFound: KeyMessage = { key: "Machines.notFound" };

/**
 * Creates a machine and redirects to the list, or updates it when `id` is
 * given and stays on its page.
 */
export async function saveMachine(id: string | null, form: FormData): Promise<MachineFormErrors> {
  const userId = await getUserId();
  if (!userId) return { form: signedOut };
  const parsed = parseMachineForm(form);
  if (parsed.errors) return parsed.errors;
  const { machine } = parsed;

  if (id === null) {
    await db.machine.create({ data: { ...machine, userId } });
  } else {
    const machineId = z.uuid().safeParse(id);
    if (!machineId.success) return { form: notFound };
    const { count } = await db.machine.updateMany({
      where: { id: machineId.data, userId },
      data: machine,
    });
    if (count === 0) return { form: notFound };
  }
  // The machine list, the new-project options and every project's machine picker.
  revalidatePath("/", "layout");
  if (id === null) redirect("/machines");
  return {};
}

/** Deletes a machine. Projects keep their own snapshot of it (ADR-0003). */
export async function deleteMachine(id: string): Promise<ActionResult> {
  const userId = await getUserId();
  if (!userId) return { error: signedOut };
  const machineId = z.uuid().safeParse(id);
  if (!machineId.success) return { error: notFound };

  const { count } = await db.machine.deleteMany({ where: { id: machineId.data, userId } });
  revalidatePath("/", "layout");
  if (count === 0) return { error: notFound };
}
