import type { Stock } from "@furrow/document";
import { describe, expect, it } from "vitest";
import { fillTouchOffBlock, suggestTouchOffToolChange } from "./touch-off";

const stock: Stock = {
  width: 300,
  height: 200,
  thickness: 18,
  xyOrigin: { anchor: "center" },
  zOrigin: "stock_top",
  touchOff: null,
};

describe("fillTouchOffBlock", () => {
  it("puts the pad's centre, in work coordinates, in place of the placeholders", () => {
    const pad = { x: 7.5, y: 192.5, diameter: 15, toolChange: null };
    expect(fillTouchOffBlock("G0 X{padX} Y{padY}\nG0 X{padX}", stock, pad)).toBe(
      "G0 X-142.5 Y92.5\nG0 X-142.5",
    );
  });
});

describe("suggestTouchOffToolChange", () => {
  it("is the default tool change over the pad without a machine block", () => {
    expect(suggestTouchOffToolChange(null, 5)).toBe(
      "M5\nG0 Z5\nG0 X{padX} Y{padY}\nM0 (Change the bit and zero Z on the touch-off pad)",
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
    expect(suggestTouchOffToolChange(block, 5)).toBe(
      [
        "M63 P1 (turn off pin 27)",
        "$HZ",
        "G0 X{padX} Y{padY} F2000 (move to probing location, X1 Y1)",
        "M0 (MSG change tool, probe)",
        "G38.2 Z-110 F200 P0.5",
        "G0 X20 Y20",
      ].join("\n"),
    );
    expect(suggestTouchOffToolChange("G00X-5.5Y.25", 5)).toBe("G00X{padX}Y{padY}");
  });

  it("moves over the pad before a block with no XY move in work coordinates", () => {
    const block = "G53 G0 X-10 Y-10\nM0 (Change the bit)";
    expect(suggestTouchOffToolChange(block, 5)).toBe(`G0 Z5\nG0 X{padX} Y{padY}\n${block}`);
  });
});
