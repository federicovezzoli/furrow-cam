import type { Stock, StockAnchor } from "@furrow/document";
import { describe, expect, it } from "vitest";
import { activeTouchOff, clampTouchOff, defaultTouchOff, touchOffOutsideStock } from "./touch-off";

const stock: Stock = {
  width: 300,
  height: 200,
  thickness: 18,
  xyOrigin: { anchor: "bottom_left" },
  zOrigin: "stock_top",
  touchOff: null,
};
const zeroed = (anchor: StockAnchor): Stock => ({ ...stock, xyOrigin: { anchor } });

describe("defaultTouchOff", () => {
  it("goes in the corner nearest each anchor, inset by its radius", () => {
    const expected: Record<StockAnchor, [number, number]> = {
      bottom_left: [7.5, 7.5],
      bottom_center: [7.5, 7.5],
      bottom_right: [292.5, 7.5],
      middle_left: [7.5, 7.5],
      center: [7.5, 7.5],
      middle_right: [292.5, 7.5],
      top_left: [7.5, 192.5],
      top_center: [7.5, 192.5],
      top_right: [292.5, 192.5],
    };
    for (const [anchor, [x, y]] of Object.entries(expected) as [StockAnchor, [number, number]][]) {
      expect(defaultTouchOff(zeroed(anchor), null)).toEqual({ x, y, diameter: 15 });
    }
  });

  it("goes in the corner nearest a custom zero, even off the stock", () => {
    const custom: Stock = { ...stock, xyOrigin: { anchor: "custom", x: 280, y: 250 } };
    expect(defaultTouchOff(custom, null)).toEqual({ x: 292.5, y: 192.5, diameter: 15 });
  });

  it("skips corners the design covers", () => {
    // The design fills the bottom of the stock, edge to edge.
    const design = { min: [0, 0] as [number, number], max: [300, 120] as [number, number] };
    expect(defaultTouchOff(stock, design)).toEqual({ x: 7.5, y: 192.5, diameter: 15 });
  });

  it("prefers a corner the whole pad is clear of, then one whose corner point is", () => {
    // A 10 mm border all round: no corner fits the 15 mm pad, every corner point is clear.
    const design = { min: [10, 10] as [number, number], max: [290, 190] as [number, number] };
    expect(defaultTouchOff(zeroed("top_right"), design)).toEqual({
      x: 292.5,
      y: 192.5,
      diameter: 15,
    });
    // The bottom-left corner fits it whole, so it wins over the nearer top-right one.
    const offset = { min: [20, 0] as [number, number], max: [300, 200] as [number, number] };
    expect(defaultTouchOff(zeroed("bottom_right"), offset)).toEqual({
      x: 7.5,
      y: 7.5,
      diameter: 15,
    });
  });

  it("is never wider than the stock's smaller side", () => {
    const strip: Stock = { ...stock, height: 10 };
    expect(defaultTouchOff(strip, null)).toEqual({ x: 5, y: 5, diameter: 10 });
  });
});

describe("activeTouchOff", () => {
  const pad = { x: 10, y: 10, diameter: 15 };

  it("is the pad with the Z zero on the stock top, and none on the machine bed", () => {
    expect(activeTouchOff({ zOrigin: "stock_top", touchOff: pad })).toEqual(pad);
    expect(activeTouchOff({ zOrigin: "machine_bed", touchOff: pad })).toBeNull();
    expect(activeTouchOff({ zOrigin: "stock_top", touchOff: null })).toBeNull();
  });
});

describe("touchOffOutsideStock", () => {
  it("says whether the pad reaches past the stock's edges", () => {
    expect(touchOffOutsideStock(stock, { x: 7.5, y: 7.5, diameter: 15 })).toBe(false);
    expect(touchOffOutsideStock(stock, { x: 5, y: 100, diameter: 15 })).toBe(true);
    expect(touchOffOutsideStock(stock, { x: 296, y: 100, diameter: 15 })).toBe(true);
  });
});

describe("clampTouchOff", () => {
  it("moves a pad past the stock's edges back onto it, keeping its diameter", () => {
    expect(clampTouchOff(stock, { x: 5, y: 210, diameter: 15 })).toEqual({
      x: 7.5,
      y: 192.5,
      diameter: 15,
    });
    expect(clampTouchOff(stock, { x: 310, y: -4, diameter: 20 })).toEqual({
      x: 290,
      y: 10,
      diameter: 20,
    });
  });

  it("leaves a pad on the stock where it is", () => {
    const pad = { x: 100, y: 50, diameter: 15 };
    expect(clampTouchOff(stock, pad)).toEqual(pad);
  });
});
