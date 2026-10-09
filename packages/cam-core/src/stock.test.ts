import type { Stock } from "@furrow/document";
import { describe, expect, it } from "vitest";
import { stockBounds, stockBox, stockOffset } from "./stock";

const stock: Stock = {
  width: 600,
  height: 400,
  thickness: 18,
  xyOrigin: "bottom_left",
  zOrigin: "stock_top",
};

describe("stock placement", () => {
  it("puts the bottom-left corner of the stock top at the origin by default", () => {
    expect(stockOffset(stock)).toEqual([0, 0, 0]);
    expect(stockBounds(stock)).toEqual({ min: [0, 0, -18], max: [600, 400, 0] });
  });

  it("centres the stock on the origin and rests it on the bed", () => {
    const centered: Stock = { ...stock, xyOrigin: "center", zOrigin: "machine_bed" };
    expect(stockOffset(centered)).toEqual([-300, -200, 18]);
    expect(stockBounds(centered)).toEqual({ min: [-300, -200, 0], max: [300, 200, 18] });
    expect(stockBox(centered)).toEqual({ min: [0, 0, -18], max: [600, 400, 0] });
  });
});
