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
