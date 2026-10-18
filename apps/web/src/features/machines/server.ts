import "server-only";
import { Machine, machineFields } from "@furrow/document";
import type { MachineChoice } from "@furrow/workspace/lib/workspace-host";
import { db } from "@/lib/db";
import { issuesToFormErrors, numberField } from "@/lib/form-data";

export type { MachineChoice };

/** The signed-in user's machine profiles, by name. */
export function listMachines(userId: string) {
  return db.machine.findMany({ where: { userId }, orderBy: { name: "asc" } });
}

/** One of the user's machines, or `null` if it doesn't exist or belongs to someone else. */
export function getMachine(userId: string, id: string) {
  return db.machine.findFirst({ where: { id, userId } });
}

/**
 * Copies a machine profile into the shape stored in a project document
 * (ADR-0003), or `null` for a row that fails today's rules. The snapshot
 * keeps no link to the row, so editing or deleting the machine later never
 * changes existing projects.
 */
export function snapshotMachine(row: Machine): Machine | null {
  const machine = Machine.safeParse(machineFields(row));
  return machine.success ? machine.data : null;
}

/** A machine profile offered when setting up a project, as the snapshot to store. */

/**
 * The user's machines as snapshots for projects, by name. Rows that fail
 * today's rules are left out until they are fixed.
 */
export async function listMachineChoices(userId: string): Promise<MachineChoice[]> {
  const rows = await listMachines(userId);
  return rows.flatMap((row) => {
    const machine = snapshotMachine(row);
    return machine ? [{ id: row.id, machine }] : [];
  });
}

/** A machine as offered in pickers that only need to tell machines apart. */
export type MachineOption = { id: string; name: string };

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
export function parseMachineForm(form: FormData) {
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
    entryClearance: numberField(form, "entryClearance"),
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
