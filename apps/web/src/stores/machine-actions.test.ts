import { createProjectDocument } from "@furrow/document";
import { lowRider, machine } from "@furrow/document/fixtures";
import { describe, expect, it } from "vitest";
import { createDocumentStore } from "./document-store";
import { matchingMachineChoice, setMachine } from "./machine-actions";

function newStore() {
  return createDocumentStore(createProjectDocument());
}

describe("setMachine", () => {
  it("snapshots the machine as one undo step", () => {
    const store = newStore();
    setMachine(store, machine);
    expect(store.getState().document.machine).toEqual(machine);
    setMachine(store, lowRider);
    expect(store.getState().document.machine).toEqual(lowRider);
    expect(store.getState().past).toHaveLength(2);
    store.getState().undo();
    expect(store.getState().document.machine).toEqual(machine);
    store.getState().undo();
    expect(store.getState().document.machine).toBeNull();
  });

  it("adds no undo step for the snapshot the project already has", () => {
    const store = newStore();
    setMachine(store, machine);
    setMachine(store, { ...machine });
    expect(store.getState().past).toHaveLength(1);
  });

  it("re-snapshots a machine edited since", () => {
    const store = newStore();
    setMachine(store, machine);
    setMachine(store, { ...machine, safeZ: 10 });
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
