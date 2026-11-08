import { createProjectDocument } from "@furrow/document";
import { lowRider, machine } from "@furrow/document/fixtures";
import { describe, expect, it } from "vitest";
import { createDocumentStore } from "./document-store";
import {
  changedMachineFields,
  matchingMachineChoice,
  outdatedMachineChoice,
  setMachine,
  sourceMachineChoice,
} from "./machine-actions";

function newStore() {
  return createDocumentStore(createProjectDocument());
}

describe("setMachine", () => {
  it("snapshots the machine and its library id as one undo step", () => {
    const store = newStore();
    setMachine(store, machine, "a");
    expect(store.getState().document.machine).toEqual(machine);
    expect(store.getState().document.machineId).toBe("a");
    setMachine(store, lowRider, "b");
    expect(store.getState().document.machine).toEqual(lowRider);
    expect(store.getState().past).toHaveLength(2);
    store.getState().undo();
    expect(store.getState().document.machine).toEqual(machine);
    expect(store.getState().document.machineId).toBe("a");
    store.getState().undo();
    expect(store.getState().document.machine).toBeNull();
    expect(store.getState().document.machineId).toBeNull();
  });

  it("adds no undo step for the snapshot the project already has", () => {
    const store = newStore();
    setMachine(store, machine, "a");
    setMachine(store, { ...machine }, "a");
    expect(store.getState().past).toHaveLength(1);
  });

  it("links a same-valued machine with another id", () => {
    const store = newStore();
    setMachine(store, machine, "a");
    setMachine(store, { ...machine }, "b");
    expect(store.getState().document.machineId).toBe("b");
  });

  it("re-snapshots a machine edited since", () => {
    const store = newStore();
    setMachine(store, machine, "a");
    setMachine(store, { ...machine, safeZ: 10 }, "a");
    expect(store.getState().document.machine?.safeZ).toBe(10);
    expect(store.getState().past).toHaveLength(2);
  });
});

describe("matchingMachineChoice", () => {
  const choices = [
    { id: "a", machine },
    { id: "b", machine: lowRider },
  ];

  it("finds the machine a snapshot was taken from", () => {
    expect(matchingMachineChoice(choices, { ...lowRider })?.id).toBe("b");
  });

  it("finds nothing for an edited snapshot or no machine", () => {
    expect(matchingMachineChoice(choices, { ...machine, maxFeedXY: 1 })).toBeUndefined();
    expect(matchingMachineChoice(choices, null)).toBeUndefined();
  });
});

describe("sourceMachineChoice", () => {
  const edited = { ...machine, safeZ: 12 };
  const choices = [
    { id: "a", machine: edited },
    { id: "b", machine: lowRider },
  ];

  it("follows the link, even to an edited machine", () => {
    expect(sourceMachineChoice(choices, { machine, machineId: "a" })?.id).toBe("a");
  });

  it("finds nothing for a deleted machine or no machine", () => {
    expect(sourceMachineChoice(choices, { machine, machineId: "gone" })).toBeUndefined();
    expect(sourceMachineChoice(choices, { machine: null, machineId: null })).toBeUndefined();
  });

  it("links a snapshot without an id by a unique name", () => {
    expect(sourceMachineChoice(choices, { machine, machineId: null })?.id).toBe("a");
    const twins = [...choices, { id: "c", machine: { ...machine, safeZ: 3 } }];
    expect(sourceMachineChoice(twins, { machine, machineId: null })).toBeUndefined();
    const renamed = { ...machine, name: "Other" };
    expect(sourceMachineChoice(choices, { machine: renamed, machineId: null })).toBeUndefined();
  });
});

describe("outdatedMachineChoice", () => {
  it("finds the source only when it has changed", () => {
    const choices = [{ id: "a", machine: { ...machine, safeZ: 12 } }];
    expect(outdatedMachineChoice(choices, { machine, machineId: "a" })?.id).toBe("a");
    expect(outdatedMachineChoice([{ id: "a", machine }], { machine, machineId: "a" })).toBe(
      undefined,
    );
    const twin = [...choices, { id: "b", machine }];
    expect(outdatedMachineChoice(twin, { machine, machineId: "a" })).toBeUndefined();
  });
});

describe("changedMachineFields", () => {
  it("lists the fields that differ", () => {
    expect(changedMachineFields(machine, { ...machine, safeZ: 12, programEnd: "M30" })).toEqual([
      "safeZ",
      "programEnd",
    ]);
  });
});
