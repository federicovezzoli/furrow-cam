import type { Stock } from "@furrow/document";
import { describe, expect, it } from "vitest";
import { fillPlaceholders, suggestTouchOffToolChange, unfilledPlaceholders } from "./touch-off";

const stock: Stock = {
  width: 300,
  height: 200,
  thickness: 18,
  xyOrigin: { anchor: "center" },
  zOrigin: "stock_top",
  touchOff: null,
};

describe("fillPlaceholders", () => {
  const block = "G0 Z{safeZ}\nG0 X{padX} Y{padY}\nG0 X{padX}";
  const pad = { x: 7.5, y: 192.5, diameter: 15, toolChange: null };

  it("puts the pad's centre and the safe Z, in work coordinates, in place of the placeholders", () => {
    expect(fillPlaceholders(block, stock, pad, 12.5)).toBe(
      "G0 Z12.5\nG0 X-142.5 Y92.5\nG0 X-142.5",
    );
  });

  it("measures the safe Z from the zero, as the post's own rises do", () => {
    const onBed = { ...stock, zOrigin: "machine_bed" as const };
    expect(fillPlaceholders("G0 Z{safeZ}", onBed, null, 5)).toBe(`G0 Z${5 + stock.thickness}`);
  });

  it("leaves the pad's placeholders without a pad, and unknown ones, for a warning", () => {
    const filled = fillPlaceholders(`${block}\nG0 Z{safez}`, stock, null, 5);
    expect(filled).toBe("G0 Z5\nG0 X{padX} Y{padY}\nG0 X{padX}\nG0 Z{safez}");
    expect(unfilledPlaceholders(filled)).toEqual(["{padX}", "{padY}", "{safez}"]);
  });
});

describe("suggestTouchOffToolChange", () => {
  it("is the default tool change over the pad without a machine block", () => {
    expect(suggestTouchOffToolChange(null)).toBe(
      "M5\nG0 Z{safeZ}\nG0 X{padX} Y{padY}\nM0 (Change the bit and zero Z on the touch-off pad)",
    );
  });

  it("puts the block's first XY move on the pad, keeping every other command", () => {
    const block = [
      "M63 P1 (turn off pin 27)",
      "$HZ",
      "G0 X10 Y10 F2000 (move to probing location, X1 Y1)",
      "M0 (MSG change tool, probe)",
      "G38.2 Z-110 F200 P0.5",
      "G0 X20 Y20",
    ].join("\n");
    expect(suggestTouchOffToolChange(block)).toBe(
      [
        "M63 P1 (turn off pin 27)",
        "$HZ",
        "G0 X{padX} Y{padY} F2000 (move to probing location, X1 Y1)",
        "M0 (MSG change tool, probe)",
        "G38.2 Z-110 F200 P0.5",
        "G0 X20 Y20",
      ].join("\n"),
    );
    expect(suggestTouchOffToolChange("G00X-5.5Y.25")).toBe("G00X{padX}Y{padY}");
  });

  it("keeps the tool over the pad until it zeroes Z, with moves one axis at a time", () => {
    expect(suggestTouchOffToolChange("G0 X10\nG0 Y10 Z5\nG0 Y12 F500\nM0\nG0 X20")).toBe(
      "G0 X{padX} Y{padY}\nG0 Z5\nM0\nG0 X20",
    );
    expect(suggestTouchOffToolChange("G1 Y10 F800 (to the probe)\nG38.2 Z-50 F100")).toBe(
      "G1 X{padX} Y{padY} F800 (to the probe)\nG38.2 Z-50 F100",
    );
  });

  it("moves to the pad in absolute coordinates where the block moves relatively", () => {
    expect(suggestTouchOffToolChange("G91\nG0 X10 Y10\nG0 Z-5\nG90\nM0")).toBe(
      "G91\nG90 G0 X{padX} Y{padY}\nG91\nG0 Z-5\nG90\nM0",
    );
    // An arc mode isn't a distance mode.
    expect(suggestTouchOffToolChange("G91.1\nG0 X10 Y10\nM0")).toBe(
      "G91.1\nG0 X{padX} Y{padY}\nM0",
    );
  });

  it("moves over the pad before a block with no XY move in work coordinates", () => {
    const block = "G53 G0 X-10 Y-10\nM0 (Change the bit)";
    expect(suggestTouchOffToolChange(block)).toBe(`G0 Z{safeZ}\nG0 X{padX} Y{padY}\n${block}`);
  });
});
