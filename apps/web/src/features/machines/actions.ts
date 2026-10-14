"use server";

import type { Machine } from "@furrow/document";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getUserId } from "@/features/auth/server";
import { db } from "@/lib/db";
import { type ActionResult, type FormErrors, SIGNED_OUT } from "@/lib/form-data";
import { parseMachineForm } from "./server";

export type MachineFormErrors = FormErrors<keyof Machine>;

const NOT_FOUND = "This machine no longer exists.";

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
