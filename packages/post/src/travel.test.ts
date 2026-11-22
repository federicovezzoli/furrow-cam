import { machine } from "@furrow/document/fixtures";
import { describe, expect, it } from "vitest";
import { travelWarnings } from "./travel";

const small = { ...machine, workAreaX: 800, workAreaZ: 50 };

describe("travelWarnings", () => {
  it("says nothing without a machine or within its travel", () => {
    expect(travelWarnings("G0 X0 Y0 Z5\nG1 X900 Z-100\n", null)).toEqual([]);
    expect(travelWarnings("G0 X0 Y0 Z5\nG1 X800 Y400 Z-1 F1000\n", small)).toEqual([]);
  });

  it("warns of an axis the program spans more of than the machine travels", () => {
    expect(travelWarnings("G0 X0 Y0 Z5\nG1 X900 Y0 Z-1 F1000\n", small)).toEqual([
      { message: { code: "export.exceedsTravel", values: { axis: "X", span: 900, travel: 800 } } },
    ]);
  });

  it("warns of each axis over travel, in order", () => {
    const warnings = travelWarnings("G0 X0 Y0 Z40\nG1 X900 Z-20 F1000\n", small);
    expect(warnings.map(({ message }) => message.values?.axis)).toEqual(["X", "Z"]);
  });

  it("ignores axes the program hasn't set yet", () => {
    const warnings = travelWarnings("G0 Z5\nG0 X10 Y10\nG1 Z-1 F500\n", small);
    expect(warnings).toEqual([]);
  });
});
