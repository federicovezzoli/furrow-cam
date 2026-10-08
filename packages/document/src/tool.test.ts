import { describe, expect, it } from "vitest";
import { endMill, vBit } from "./fixtures";
import { Tool } from "./tool";

describe("Tool", () => {
  it("accepts end mills and V-bits", () => {
    expect(Tool.parse(endMill)).toEqual(endMill);
    expect(Tool.parse(vBit)).toEqual(vBit);
    expect(Tool.parse({ ...endMill, type: "drill", cutDirection: null })).toBeTruthy();
  });

  it("requires a cut direction on end mills only", () => {
    expect(Tool.safeParse({ ...endMill, cutDirection: null }).success).toBe(false);
    expect(Tool.safeParse({ ...endMill, type: "drill" }).success).toBe(false);
  });

  it("requires V-bit geometry on V-bits only", () => {
    expect(Tool.safeParse({ ...vBit, vAngle: null }).success).toBe(false);
    expect(Tool.safeParse({ ...vBit, tipDiameter: null }).success).toBe(false);
    expect(Tool.safeParse({ ...endMill, vAngle: 90 }).success).toBe(false);
    expect(Tool.safeParse({ ...vBit, tipDiameter: vBit.diameter }).success).toBe(false);
  });

  it("rejects out-of-range values", () => {
    expect(Tool.safeParse({ ...endMill, diameter: 0 }).success).toBe(false);
    expect(Tool.safeParse({ ...endMill, fluteCount: 1.5 }).success).toBe(false);
    expect(Tool.safeParse({ ...endMill, stepOver: 120 }).success).toBe(false);
    expect(Tool.safeParse({ ...endMill, name: "  " }).success).toBe(false);
    expect(Tool.safeParse({ ...endMill, stepDown: endMill.fluteLength + 1 }).success).toBe(false);
    expect(Tool.safeParse({ ...vBit, vAngle: 180 }).success).toBe(false);
    expect(Tool.safeParse({ ...endMill, color: "blue" }).success).toBe(false);
    expect(Tool.safeParse({ ...endMill, color: "#2563EB" }).success).toBe(false);
  });

  it("does not change names while parsing", () => {
    const padded = { ...endMill, name: " 1/4 upcut " };
    expect(Tool.parse(padded)).toEqual(padded);
  });

  it("snapshots a database row without its row fields", () => {
    const row = {
      ...endMill,
      id: "4f8a1c2e-6b3d-4e5f-9a7b-8c9d0e1f2a3b",
      userId: "user-1",
      isDefault: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const snapshot = Tool.parse(row);
    expect(snapshot).toEqual(endMill);

    // Editing the library row afterwards must not reach the snapshot (ADR-0003).
    row.feedRate = 9999;
    expect(snapshot.feedRate).toBe(endMill.feedRate);
  });
});
