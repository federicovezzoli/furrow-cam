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
  it("is centred on the XY zero at each anchor", () => {
    const expected: Record<StockAnchor, [number, number]> = {
      bottom_left: [0, 0],
      bottom_center: [150, 0],
      bottom_right: [300, 0],
      middle_left: [0, 100],
      center: [150, 100],
      middle_right: [300, 100],
      top_left: [0, 200],
      top_center: [150, 200],
      top_right: [300, 200],
    };
    for (const [anchor, [x, y]] of Object.entries(expected) as [StockAnchor, [number, number]][]) {
      expect(defaultTouchOff(zeroed(anchor))).toEqual({ x, y, diameter: 15, toolChange: null });
    }
  });

  it("is centred on a custom zero, even off the stock", () => {
    const custom: Stock = { ...stock, xyOrigin: { anchor: "custom", x: 280, y: 250 } };
    expect(defaultTouchOff(custom)).toEqual({ x: 280, y: 250, diameter: 15, toolChange: null });
  });

  it("is never wider than the stock's smaller side", () => {
    const strip: Stock = { ...stock, height: 10, xyOrigin: { anchor: "center" } };
    expect(defaultTouchOff(strip)).toEqual({ x: 150, y: 5, diameter: 10, toolChange: null });
  });
});

describe("activeTouchOff", () => {
  const pad = { x: 10, y: 10, diameter: 15, toolChange: null };

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
    const toolChange = "G0 X{padX} Y{padY}\nM0";
    expect(clampTouchOff(stock, { x: 5, y: 210, diameter: 15, toolChange })).toEqual({
      x: 7.5,
      y: 192.5,
      diameter: 15,
      toolChange,
    });
    expect(clampTouchOff(stock, { x: 310, y: -4, diameter: 20, toolChange: null })).toEqual({
      x: 290,
      y: 10,
      diameter: 20,
      toolChange: null,
    });
  });

  it("leaves a pad on the stock where it is", () => {
    const pad = { x: 100, y: 50, diameter: 15, toolChange: null };
    expect(clampTouchOff(stock, pad)).toEqual(pad);
  });
});
