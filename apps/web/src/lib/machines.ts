import { Machine, machineFields } from "@furrow/document";
import { db } from "@/lib/db";

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
 * (ADR-0003). The snapshot keeps no link to the row, so editing or deleting
 * the machine later never changes existing projects.
 */
export function snapshotMachine(row: Machine): Machine {
  return Machine.parse(machineFields(row));
}

/** Like `snapshotMachine`, but `null` for a row that fails today's rules instead of throwing. */
export function safeSnapshotMachine(row: Machine): Machine | null {
  const machine = Machine.safeParse(machineFields(row));
  return machine.success ? machine.data : null;
}

/** A machine profile offered when setting up a project, as the snapshot to store. */
export type MachineChoice = { id: string; machine: Machine };

/**
 * The user's machines as snapshots for projects, by name. Rows that fail
 * today's rules are left out until they are fixed.
 */
export async function listMachineChoices(userId: string): Promise<MachineChoice[]> {
  const rows = await listMachines(userId);
  return rows.flatMap((row) => {
    const machine = safeSnapshotMachine(row);
    return machine ? [{ id: row.id, machine }] : [];
  });
}

/** A machine as offered in pickers that only need to tell machines apart. */
export type MachineOption = { id: string; name: string };
