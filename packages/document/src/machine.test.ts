import { describe, expect, it } from "vitest";
import { lowRider, machine } from "./fixtures";
import { Machine, machineFields } from "./machine";

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
});
