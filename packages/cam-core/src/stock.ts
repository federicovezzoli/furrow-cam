import type { Stock } from "@furrow/document";

/** `[x, y, z]` in millimetres. */
export type Vec3 = [number, number, number];

/** An axis-aligned box. */
export type Box3 = { min: Vec3; max: Vec3 };

/**
 * Where the stock coordinate frame sits in work coordinates (ADR-0014).
 * Geometry is stored in stock coordinates: `(0, 0)` is the stock's bottom-left
 * corner and `z = 0` its top, so changing the work origin never moves the
 * design on the stock.
 * Work coordinates have their origin where the stock's XY and Z origins say,
 * which is where the machine is zeroed and what G-code is written in.
 */
export function stockOffset(stock: Stock): Vec3 {
  const centered = stock.xyOrigin === "center";
  return [
    centered ? -stock.width / 2 : 0,
    centered ? -stock.height / 2 : 0,
    stock.zOrigin === "machine_bed" ? stock.thickness : 0,
  ];
}

/** The space the stock occupies, in stock coordinates. */
export function stockBox(stock: Stock): Box3 {
  return { min: [0, 0, -stock.thickness], max: [stock.width, stock.height, 0] };
}

/** The space the stock occupies, in work coordinates. */
export function stockBounds(stock: Stock): Box3 {
  const [x, y, z] = stockOffset(stock);
  const { min, max } = stockBox(stock);
  return {
    min: [min[0] + x, min[1] + y, min[2] + z],
    max: [max[0] + x, max[1] + y, max[2] + z],
  };
}
