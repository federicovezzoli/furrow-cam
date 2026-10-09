import { describe, expect, it } from "vitest";
import { lowRider, machine } from "./fixtures";
import { Machine } from "./machine";

describe("Machine", () => {
  it("accepts a machine with a controlled spindle", () => {
    expect(Machine.parse(machine)).toEqual(machine);
  });

  it("strips extra keys, so a database row can be snapshotted", () => {
    const row = { ...machine, id: "m1", userId: "u1", createdAt: new Date() };
    expect(Machine.parse(row)).toEqual(machine);
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
  });

  it("snapshots a copy, so later changes to the row don't reach the project", () => {
    const row = { ...machine, id: "m1" };
    const snapshot = Machine.parse(row);
    row.safeZ = 10;
    expect(snapshot.safeZ).toBe(machine.safeZ);
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
