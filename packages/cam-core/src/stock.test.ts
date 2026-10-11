import type { Stock, StockAnchor } from "@furrow/document";
import { describe, expect, it } from "vitest";
import { stockBounds, stockBox, stockOffset, xyOriginPosition } from "./stock";

const stock: Stock = {
  width: 600,
  height: 400,
  thickness: 18,
  xyOrigin: { anchor: "bottom_left" },
  zOrigin: "stock_top",
};

describe("stock placement", () => {
  it("puts the bottom-left corner of the stock top at the origin by default", () => {
    expect(stockOffset(stock)).toEqual([0, 0, 0]);
    expect(stockBounds(stock)).toEqual({ min: [0, 0, -18], max: [600, 400, 0] });
  });

  it("centres the stock on the origin and rests it on the bed", () => {
    const centered: Stock = { ...stock, xyOrigin: { anchor: "center" }, zOrigin: "machine_bed" };
    expect(stockOffset(centered)).toEqual([-300, -200, 18]);
    expect(stockBounds(centered)).toEqual({ min: [-300, -200, 0], max: [300, 200, 18] });
    expect(stockBox(centered)).toEqual({ min: [0, 0, -18], max: [600, 400, 0] });
  });

  it.each<[StockAnchor, [number, number]]>([
    ["bottom_left", [0, 0]],
    ["bottom_center", [300, 0]],
    ["bottom_right", [600, 0]],
    ["middle_left", [0, 200]],
    ["center", [300, 200]],
    ["middle_right", [600, 200]],
    ["top_left", [0, 400]],
    ["top_center", [300, 400]],
    ["top_right", [600, 400]],
  ])("puts the %s anchor at %j on the stock", (anchor, [x, y]) => {
    const anchored: Stock = { ...stock, xyOrigin: { anchor } };
    expect(xyOriginPosition(anchored)).toEqual([x, y]);
    expect(stockOffset(anchored)).toEqual([0 - x, 0 - y, 0]);
    expect(stockBounds(anchored)).toEqual({
      min: [0 - x, 0 - y, -18],
      max: [600 - x, 400 - y, 0],
    });
  });

  it("moves anchors with the stock when it is resized", () => {
    const topRight: Stock = { ...stock, xyOrigin: { anchor: "top_right" } };
    expect(stockOffset({ ...topRight, width: 800, height: 300 })).toEqual([-800, -300, 0]);
    const topCenter: Stock = { ...stock, xyOrigin: { anchor: "top_center" } };
    expect(stockOffset({ ...topCenter, width: 500 })).toEqual([-250, -400, 0]);
  });

  it("keeps a custom zero at its stock position when the stock is resized", () => {
    const custom: Stock = { ...stock, xyOrigin: { anchor: "custom", x: 120, y: 35.5 } };
    expect(stockOffset(custom)).toEqual([-120, -35.5, 0]);
    expect(stockOffset({ ...custom, width: 200, height: 100 })).toEqual([-120, -35.5, 0]);
    expect(stockBounds({ ...custom, zOrigin: "machine_bed" })).toEqual({
      min: [-120, -35.5, 0],
      max: [480, 364.5, 18],
    });
  });

  it("allows a custom zero outside the stock", () => {
    const fence: Stock = { ...stock, xyOrigin: { anchor: "custom", x: -20, y: 450 } };
    expect(stockOffset(fence)).toEqual([20, -450, 0]);
    expect(stockBounds(fence)).toEqual({ min: [20, -450, -18], max: [620, -50, 0] });
  });
});
