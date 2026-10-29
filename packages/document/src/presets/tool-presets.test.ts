import { describe, expect, it } from "vitest";
import { Tool } from "../schema/tool";
import { DEFAULT_TOOL_PRESET, TOOL_PRESET_ID_PREFIX, TOOL_PRESETS } from "./tool-presets";

describe("TOOL_PRESETS", () => {
  it("are all valid tools", () => {
    for (const { tool } of TOOL_PRESETS) expect(Tool.safeParse(tool).success).toBe(true);
  });

  it("have unique, prefixed ids and unique names", () => {
    const ids = TOOL_PRESETS.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id.startsWith(TOOL_PRESET_ID_PREFIX)).toBe(true);
    const names = TOOL_PRESETS.map((preset) => preset.tool.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("cover the bit types PRD-0008 G4 lists", () => {
    const tools = TOOL_PRESETS.map((preset) => preset.tool);
    expect(new Set(tools.map((tool) => tool.cutDirection))).toEqual(
      new Set(["upcut", "downcut", "compression", null]),
    );
    expect(tools.some((tool) => tool.type === "ball_end_mill")).toBe(true);
    expect(
      new Set(tools.filter((tool) => tool.type === "v_bit").map((tool) => tool.vAngle)),
    ).toEqual(new Set([30, 60, 90]));
    // Metric and imperial sizes.
    expect(tools.some((tool) => tool.diameter === 6)).toBe(true);
    expect(tools.some((tool) => tool.diameter === 6.35)).toBe(true);
  });

  it("start new operations with the 6 mm upcut", () => {
    expect(DEFAULT_TOOL_PRESET.tool.name).toBe("6 mm 2-flute upcut");
  });

  it("give V-bits the cutting length of their angle", () => {
    const v90 = TOOL_PRESETS.find((preset) => preset.tool.vAngle === 90)?.tool;
    expect(v90?.fluteLength).toBeCloseTo(v90 ? v90.diameter / 2 : 0, 2);
  });
});
