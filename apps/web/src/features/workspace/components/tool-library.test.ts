import type { Tool } from "@furrow/document";
import { describe, expect, it } from "vitest";
import type { ToolChoice } from "@/features/tools/server";
import { matchingToolChoice, newBitType, withAddedTool, withUpdatedTool } from "./tool-library";

const endMill: Tool = {
  name: "6 mm upcut",
  type: "flat_end_mill",
  diameter: 6,
  fluteCount: 2,
  fluteLength: 22,
  cutDirection: "upcut",
  vAngle: null,
  tipDiameter: null,
  spindleRpm: 24000,
  feedRate: 600,
  plungeRate: 300,
  plungeAngle: 3,
  stepDown: 1,
  stepOver: 40,
  notes: null,
  color: "#2563eb",
};

const choice = (id: string, name: string): ToolChoice => ({
  id,
  isDefault: false,
  tool: { ...endMill, name },
});

const library = [choice("a", "3 mm upcut"), choice("c", "8 mm upcut")];

describe("withAddedTool", () => {
  it("adds a new bit in name order", () => {
    const added = choice("b", "6 mm upcut");
    expect(withAddedTool(library, added).map((tool) => tool.id)).toEqual(["a", "b", "c"]);
  });

  it("adds a bit named after every other at the end", () => {
    const added = choice("d", "V-bit");
    expect(withAddedTool(library, added).map((tool) => tool.id)).toEqual(["a", "c", "d"]);
  });

  it("ignores a bit already in the library", () => {
    expect(withAddedTool(library, choice("a", "3 mm upcut"))).toBe(library);
  });

  it("lets an operation's snapshot of the new bit match it", () => {
    const added = choice("b", "6 mm upcut");
    expect(matchingToolChoice(withAddedTool(library, added), added.tool)).toBe(added);
  });
});

describe("withUpdatedTool", () => {
  it("replaces only the edited bit", () => {
    const edited: Tool = { ...endMill, name: "3 mm upcut", feedRate: 900 };
    const updated = withUpdatedTool(library, "a", edited);
    expect(updated[0]).toEqual({ id: "a", isDefault: false, tool: edited });
    expect(updated[1]).toBe(library[1]);
  });
});

describe("newBitType", () => {
  it("starts a new bit as the type that suits the operation", () => {
    expect(newBitType("drill")).toBe("drill");
    expect(newBitType("engrave")).toBe("v_bit");
    expect(newBitType("vcarve")).toBe("v_bit");
    expect(newBitType("relief_finish")).toBe("ball_end_mill");
    expect(newBitType("relief_rough")).toBe("flat_end_mill");
    expect(newBitType("profile")).toBe("flat_end_mill");
    expect(newBitType("pocket")).toBe("flat_end_mill");
  });
});
