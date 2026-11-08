import { type Machine, machineFields, type ProjectDocument } from "@furrow/document";
import type { DocumentStore } from "./document-store";

/** Compares machine snapshots by value. */
export function machineKey(machine: Machine): string {
  return JSON.stringify(machineFields(machine));
}

/**
 * Snapshots `machine`, library machine `machineId`, into the project
 * (ADR-0003, ADR-0079) as one undo step (ADR-0010). Choosing the snapshot the
 * project already has adds none.
 */
export function setMachine(store: DocumentStore, machine: Machine, machineId: string | null) {
  const current = store.getState().document;
  // Checked here: assigning a new object would be a change even for the same profile.
  if (
    current.machine &&
    current.machineId === machineId &&
    machineKey(current.machine) === machineKey(machine)
  ) {
    return;
  }
  store.getState().change("setMachine", (draft) => {
    draft.machine = machineFields(machine);
    draft.machineId = machineId;
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

/**
 * The library machine the project's snapshot came from (ADR-0079): the one
 * it links to, or for a snapshot without a link, the only one of its name.
 */
export function sourceMachineChoice<Choice extends { id: string; machine: Machine }>(
  machines: Choice[],
  { machine, machineId }: Pick<ProjectDocument, "machine" | "machineId">,
): Choice | undefined {
  if (!machine) return undefined;
  if (machineId !== null) return machines.find((choice) => choice.id === machineId);
  const named = machines.filter((choice) => choice.machine.name === machine.name);
  return named.length === 1 ? named[0] : undefined;
}

/**
 * The snapshot's library machine, when it has been edited since the project
 * took its copy and no other library machine still has the snapshot's values.
 */
export function outdatedMachineChoice<Choice extends { id: string; machine: Machine }>(
  machines: Choice[],
  document: Pick<ProjectDocument, "machine" | "machineId">,
): Choice | undefined {
  // The machine select shows that one, so offering another would contradict it.
  if (matchingMachineChoice(machines, document.machine)) return undefined;
  const source = sourceMachineChoice(machines, document);
  if (!source || !document.machine) return undefined;
  return machineKey(source.machine) === machineKey(document.machine) ? undefined : source;
}

/** The profile fields whose values differ between `from` and `to`, in schema order. */
export function changedMachineFields(from: Machine, to: Machine): (keyof Machine)[] {
  const a = machineFields(from);
  const b = machineFields(to);
  return (Object.keys(a) as (keyof Machine)[]).filter((key) => a[key] !== b[key]);
}
