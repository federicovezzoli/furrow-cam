import type { Stock } from "@furrow/document";
import { endMill } from "@furrow/document/fixtures";
import { describe, expect, it } from "vitest";
import { padLabel, sideSetupLines, xyZeroLabel, zZeroLabel } from "./setup-notes";

const stock: Stock = {
  width: 300,
  height: 200,
  thickness: 18,
  xyOrigin: { anchor: "bottom_left" },
  zOrigin: "stock_top",
  touchOff: null,
  twoSided: null,
};
const twoSided: Stock = {
  ...stock,
  twoSided: { flipAxis: "x", partingDepth: 9, tabs: null, lineUp: null },
};

describe("padLabel", () => {
  it("gives the pad's centre in work coordinates and its diameter", () => {
    const pad = { x: 20, y: 30, diameter: 25, toolChange: null };
    expect(padLabel({ ...stock, xyOrigin: { anchor: "center" } }, pad)).toBe(
      "X-130 Y-70, 25 mm across",
    );
  });
});

describe("zero labels", () => {
  it("names the XY zero's anchor, or its offset from the bottom-left corner", () => {
    expect(xyZeroLabel(stock)).toBe("at the bottom-left corner of the stock");
    expect(xyZeroLabel({ ...stock, xyOrigin: { anchor: "top_center" } })).toBe(
      "at the middle of the top edge of the stock",
    );
    expect(xyZeroLabel({ ...stock, xyOrigin: { anchor: "custom", x: 10, y: 20.5 } })).toBe(
      "at X10 Y20.5 mm from the stock's bottom-left corner",
    );
  });

  it("names the Z zero", () => {
    expect(zZeroLabel(stock)).toBe("at the stock top");
    expect(zZeroLabel({ ...stock, zOrigin: "machine_bed" })).toBe("at the machine bed");
  });
});

describe("sideSetupLines (ADR-0060)", () => {
  it("says nothing about turning over a top side with no bottom side's file", () => {
    expect(sideSetupLines(twoSided, { side: "top", other: false, pins: false }, endMill)).toEqual([
      "Two-sided: top side, cut first",
    ]);
  });

  it("tells the top side to turn the stock over and run the bottom side's file", () => {
    expect(sideSetupLines(twoSided, { side: "top", other: true, pins: false }, endMill)).toEqual([
      "Two-sided: top side, cut first",
      "Then turn the stock over by half a turn about its centre line along X, in place, and run the bottom side's file",
    ]);
  });

  it("tells the bottom side to turn the stock over, load the first tool and zero", () => {
    const bed: Stock = { ...twoSided, zOrigin: "machine_bed" };
    expect(sideSetupLines(bed, { side: "bottom", other: true, pins: false }, endMill)).toEqual([
      "Two-sided: bottom side, cut second",
      "Run the top side's file first",
      "Before this file, turn the stock over by half a turn about its centre line along X, in place, so the face that was underneath is on top",
      `Load ${endMill.name}, 6.35 mm`,
      "Zero as for the top side, Z still at the machine bed",
    ]);
  });

  it("leaves out the top side's file and the tool when there are none", () => {
    const lines = sideSetupLines(
      twoSided,
      { side: "bottom", other: false, pins: false },
      undefined,
    );
    expect(lines).not.toContain("Run the top side's file first");
    expect(lines.some((line) => line.startsWith("Load "))).toBe(false);
  });
});
