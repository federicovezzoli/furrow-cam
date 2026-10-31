import { describe, expect, it } from "vitest";
import { endMill, taperedBallEndMill, vBit } from "../fixtures";
import { Tool } from "./tool";

describe("Tool", () => {
  it("accepts end mills and V-bits", () => {
    expect(Tool.parse(endMill)).toEqual(endMill);
    expect(Tool.parse(vBit)).toEqual(vBit);
    expect(
      Tool.parse({ ...endMill, type: "drill", cutDirection: null, plungeAngle: 90 }),
    ).toBeTruthy();
  });

  it("requires a cut direction on end mills only", () => {
    expect(Tool.safeParse({ ...endMill, cutDirection: null }).success).toBe(false);
    expect(Tool.safeParse({ ...endMill, type: "drill", plungeAngle: 90 }).success).toBe(false);
  });

  it("limits the plunge angle, and keeps drills at 90°", () => {
    expect(Tool.safeParse({ ...endMill, plungeAngle: 90 }).success).toBe(true);
    expect(Tool.safeParse({ ...endMill, plungeAngle: 1 }).success).toBe(true);
    expect(Tool.safeParse({ ...endMill, plungeAngle: 0.5 }).success).toBe(false);
    expect(Tool.safeParse({ ...endMill, plungeAngle: 91 }).success).toBe(false);
    const drill = { ...endMill, type: "drill", cutDirection: null };
    expect(Tool.safeParse({ ...drill, plungeAngle: 45 }).success).toBe(false);
  });

  it("requires V-bit geometry on V-bits only", () => {
    expect(Tool.safeParse({ ...vBit, vAngle: null }).success).toBe(false);
    expect(Tool.safeParse({ ...vBit, tipDiameter: null }).success).toBe(false);
    expect(Tool.safeParse({ ...endMill, vAngle: 90 }).success).toBe(false);
    expect(Tool.safeParse({ ...vBit, tipDiameter: vBit.diameter }).success).toBe(false);
  });

  it("requires a taper angle and a ball tip on tapered ball end mills only (#425)", () => {
    expect(Tool.parse(taperedBallEndMill)).toEqual(taperedBallEndMill);
    expect(Tool.safeParse({ ...taperedBallEndMill, taperAngle: null }).success).toBe(false);
    expect(Tool.safeParse({ ...taperedBallEndMill, tipDiameter: null }).success).toBe(false);
    expect(Tool.safeParse({ ...taperedBallEndMill, tipDiameter: 0 }).success).toBe(false);
    expect(Tool.safeParse({ ...taperedBallEndMill, tipDiameter: 3.175 }).success).toBe(false);
    expect(Tool.safeParse({ ...taperedBallEndMill, taperAngle: 90 }).success).toBe(false);
    expect(Tool.safeParse({ ...taperedBallEndMill, cutDirection: null }).success).toBe(false);
    expect(Tool.safeParse({ ...taperedBallEndMill, vAngle: 30 }).success).toBe(false);
    expect(Tool.safeParse({ ...endMill, taperAngle: 1.5 }).success).toBe(false);
    expect(Tool.safeParse({ ...vBit, taperAngle: 1.5 }).success).toBe(false);
  });

  it("works out a tapered ball end mill's diameter from its tip, angle and flute length", () => {
    // 0.25 mm ball, 1.5° per side, 20 mm up the cone.
    const angle = (1.5 * Math.PI) / 180;
    const top = 0.25 * Math.cos(angle) + (20 - 0.25 * (1 - Math.sin(angle))) * Math.tan(angle);
    expect(taperedBallEndMill.diameter).toBeCloseTo(2 * top, 12);
    // The shank's size, a likely slip, is refused.
    const shank = Tool.safeParse({ ...taperedBallEndMill, diameter: 3.175 });
    expect(shank.error?.issues[0]?.message).toBe("tool.taperedDiameter");
  });

  it("reads tools saved before tapered bits with no taper angle", () => {
    const { taperAngle: _, ...older } = endMill;
    expect(Tool.parse(older)).toEqual(endMill);
  });

  it("rejects out-of-range values", () => {
    expect(Tool.safeParse({ ...endMill, diameter: 0 }).success).toBe(false);
    expect(Tool.safeParse({ ...endMill, fluteCount: 1.5 }).success).toBe(false);
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
