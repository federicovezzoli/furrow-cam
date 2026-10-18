import { describe, expect, it } from "vitest";
import { cutterOutline } from "./cutter-outline";

describe("cutterOutline", () => {
  it("draws a flat end mill square at the tip", () => {
    expect(
      cutterOutline({ type: "flat_end_mill", diameter: 6, vAngle: null, tipDiameter: null }),
    ).toEqual([
      [0, 0],
      [3, 0],
      [3, 12],
      [0, 12],
    ]);
  });

  it("rounds a ball end mill's tip up to its radius", () => {
    const outline = cutterOutline({
      type: "ball_end_mill",
      diameter: 6,
      vAngle: null,
      tipDiameter: null,
    });
    expect(outline[0]).toEqual([0, 0]);
    expect(outline.at(-3)).toEqual([3, 3]);
    expect(outline.at(-2)).toEqual([3, 15]);
  });

  it("draws a V-bit's cone over its flat tip", () => {
    const outline = cutterOutline({ type: "v_bit", diameter: 12, vAngle: 90, tipDiameter: 2 });
    const [r, z] = outline.at(-3) ?? [];
    expect(r).toBe(6);
    // A 90° bit rises as fast as it widens past its 1 mm flat.
    expect(z).toBeCloseTo(5);
    expect(outline[1]?.[1]).toBe(0);
  });
});
