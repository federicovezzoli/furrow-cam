import { type Machine, machineFields } from "@furrow/document";
import type { DocumentStore } from "./document-store";

/** Compares machine snapshots by value. */
export function machineKey(machine: Machine): string {
  return JSON.stringify(machineFields(machine));
}

/**
 * Snapshots `machine` into the project (ADR-0003) as one undo step
 * (ADR-0010). Choosing the snapshot the project already has adds none.
 */
export function setMachine(store: DocumentStore, machine: Machine) {
  const current = store.getState().document.machine;
  // Checked here: assigning a new object would be a change even for the same profile.
  if (current && machineKey(current) === machineKey(machine)) return;
  store.getState().change("setMachine", (draft) => {
    draft.machine = machineFields(machine);
  });
}

/** The library machine a project's snapshot was taken from, if it hasn't been edited since. */
export function matchingMachineChoice<Choice extends { machine: Machine }>(
  machines: Choice[],
  machine: Machine | null,
): Choice | undefined {
  if (!machine) return undefined;
  const key = machineKey(machine);
  return machines.find((choice) => machineKey(choice.machine) === key);
}
