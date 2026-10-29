import { describe, expect, it } from "vitest";
import { lowRider, machine } from "./fixtures";
import {
  DEFAULT_SPIN_UP_DELAY,
  Machine,
  machineFields,
  machineSpinUpDelay,
  upgradeMachine,
} from "./machine";

describe("Machine", () => {
  it("accepts a machine with a controlled spindle", () => {
    expect(Machine.parse(machine)).toEqual(machine);
  });

  it("rejects unknown keys, so a misspelt or newer field fails loudly", () => {
    expect(Machine.safeParse({ ...machine, programstart: "G21" }).success).toBe(false);
  });

  it("reads the profile fields out of a database row without validating them", () => {
    const row = { ...machine, id: "m1", userId: "u1", createdAt: new Date() };
    expect(machineFields(row)).toEqual(machine);
    // Fails today's rules, but must still reach the form so it can be fixed.
    const stale = { ...row, safeZ: row.workAreaZ };
    expect(machineFields(stale)).toEqual({ ...machine, safeZ: machine.workAreaZ });
  });

  it("accepts a manual spindle with no speed range", () => {
    expect(Machine.parse(lowRider)).toEqual(lowRider);
  });

  it("rejects a half-set or inverted speed range", () => {
    expect(Machine.safeParse({ ...machine, spindleRpmMin: null }).success).toBe(false);
    expect(Machine.safeParse({ ...machine, spindleRpmMax: null }).success).toBe(false);
    expect(Machine.safeParse({ ...machine, spindleRpmMin: 40000 }).success).toBe(false);
  });

  it("accepts fractional lengths and feeds but only whole spindle speeds, like the database", () => {
    const fractional = { ...machine, workAreaZ: 95.5, safeZ: 2.5, maxFeedZ: 1250.5 };
    expect(Machine.parse(fractional)).toEqual(fractional);
    expect(Machine.safeParse({ ...machine, spindleRpmMax: 30000.5 }).success).toBe(false);
    expect(Machine.safeParse({ ...machine, spindleRpmMax: 3_000_000_000 }).success).toBe(false);
  });

  it("keeps custom G-code blocks verbatim and rejects blank or oversized ones", () => {
    const programStart = "G21\nG90\nG94\nG92.1\nG0 Z20\nM62 P1 (start spindle pin 27)";
    expect(Machine.parse({ ...machine, programStart }).programStart).toBe(programStart);
    expect(Machine.safeParse({ ...machine, programEnd: " \n " }).success).toBe(false);
    expect(Machine.safeParse({ ...machine, toolChange: "M0\n".repeat(5000) }).success).toBe(false);
  });

  it("rejects unknown post-processors and non-positive sizes", () => {
    expect(Machine.safeParse({ ...machine, postProcessor: "marlin" }).success).toBe(false);
    expect(Machine.safeParse({ ...machine, workAreaZ: 0 }).success).toBe(false);
    expect(Machine.safeParse({ ...machine, safeZ: -1 }).success).toBe(false);
    expect(Machine.safeParse({ ...machine, safeZ: machine.workAreaZ }).success).toBe(false);
  });

  it("accepts an entry clearance from zero up to the safe Z", () => {
    for (const entryClearance of [0, 0.5, machine.safeZ]) {
      expect(Machine.parse({ ...machine, entryClearance }).entryClearance).toBe(entryClearance);
    }
    expect(Machine.safeParse({ ...machine, entryClearance: -0.1 }).success).toBe(false);
    const above = Machine.safeParse({ ...machine, entryClearance: machine.safeZ + 0.1 });
    expect(above.error?.issues).toMatchObject([{ path: ["entryClearance"] }]);
  });
});

describe("machineSpinUpDelay", () => {
  it("is the machine's delay to the millisecond, the default without one, none when manual", () => {
    expect(machineSpinUpDelay(machine)).toBe(machine.spinUpDelay);
    expect(machineSpinUpDelay({ ...machine, spinUpDelay: 1.23456 })).toBe(1.235);
    expect(machineSpinUpDelay({ ...machine, spinUpDelay: 0.0004 })).toBe(0);
    expect(machineSpinUpDelay(null)).toBe(DEFAULT_SPIN_UP_DELAY);
    expect(machineSpinUpDelay(lowRider)).toBe(0);
  });
});

describe("upgradeMachine", () => {
  it("fills in the fields machines stored by earlier releases lack, keeping the rest", () => {
    const { spinUpDelay: _, ...stored } = machine;
    expect(Machine.parse(upgradeMachine(stored))).toEqual({
      ...machine,
      spinUpDelay: DEFAULT_SPIN_UP_DELAY,
    });
    expect(upgradeMachine({ ...machine, spinUpDelay: 8 })).toEqual({ ...machine, spinUpDelay: 8 });
    expect(upgradeMachine(null)).toBeNull();
  });
});
