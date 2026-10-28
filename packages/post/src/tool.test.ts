import { ballEndMill, drill, endMill, vBit } from "@furrow/document/fixtures";
import { describe, expect, it } from "vitest";
import { sameBit, toolLabel, toolShapeComment } from "./tool";

describe("toolShapeComment (ADR-0042)", () => {
  it("gives each tool type's cutter shape, leaving out fields that don't apply", () => {
    expect(toolShapeComment(endMill)).toBe("(Furrow tool: type=flat_end_mill diameter=6.35)");
    expect(toolShapeComment(ballEndMill)).toBe("(Furrow tool: type=ball_end_mill diameter=3)");
    expect(toolShapeComment(drill)).toBe("(Furrow tool: type=drill diameter=6)");
    expect(toolShapeComment({ ...vBit, diameter: 12, tipDiameter: 0.2 })).toBe(
      "(Furrow tool: type=v_bit diameter=12 vAngle=60 tipDiameter=0.2)",
    );
  });

  it("uses the post's number formatting", () => {
    expect(toolShapeComment({ ...vBit, diameter: 3.175, vAngle: 89.99999, tipDiameter: 0.1 })).toBe(
      "(Furrow tool: type=v_bit diameter=3.175 vAngle=90 tipDiameter=0.1)",
    );
  });
});

describe("sameBit", () => {
  it("ignores cutting data, which doesn't change the bit", () => {
    expect(sameBit(endMill, { ...endMill, spindleRpm: 12000, feedRate: 900, notes: "x" })).toBe(
      true,
    );
  });

  it("tells bits apart by any of their shape or name", () => {
    expect(sameBit(endMill, { ...endMill, diameter: 3.175 })).toBe(false);
    expect(sameBit(endMill, { ...endMill, cutDirection: "downcut" })).toBe(false);
    expect(sameBit(endMill, { ...endMill, name: "Another" })).toBe(false);
  });
});

describe("toolLabel", () => {
  it("gives the name and the diameter", () => {
    expect(toolLabel({ ...endMill, name: "Flat", diameter: 1 / 3 })).toBe("Flat, 0.333 mm");
  });
});
