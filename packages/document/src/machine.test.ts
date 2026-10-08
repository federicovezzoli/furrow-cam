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

  it("rejects unknown post-processors and non-positive sizes", () => {
    expect(Machine.safeParse({ ...machine, postProcessor: "marlin" }).success).toBe(false);
    expect(Machine.safeParse({ ...machine, workAreaZ: 0 }).success).toBe(false);
    expect(Machine.safeParse({ ...machine, safeZ: -1 }).success).toBe(false);
    expect(Machine.safeParse({ ...machine, safeZ: machine.workAreaZ }).success).toBe(false);
  });
});
