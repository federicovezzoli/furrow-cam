import type { Stock, XYOrigin } from "@furrow/document";

/** `[x, y, z]` in millimetres. */
export type Vec3 = [number, number, number];

/** An axis-aligned box. */
export type Box3 = { min: Vec3; max: Vec3 };

/** How far along the stock's width and height each anchor is (ADR-0016). */
const ANCHOR_FRACTIONS = {
  bottom_left: [0, 0],
  bottom_center: [0.5, 0],
  bottom_right: [1, 0],
  middle_left: [0, 0.5],
  center: [0.5, 0.5],
  middle_right: [1, 0.5],
  top_left: [0, 1],
  top_center: [0.5, 1],
  top_right: [1, 1],
} as const;

/**
 * The XY zero in stock coordinates. Anchors follow the stock's size; a custom
 * zero is already in stock coordinates.
 */
export function xyOriginPosition(
  stock: Pick<Stock, "width" | "height">,
  origin: XYOrigin,
): [number, number] {
  if (origin.anchor === "custom") return [origin.x, origin.y];
  const [fx, fy] = ANCHOR_FRACTIONS[origin.anchor];
  return [fx * stock.width, fy * stock.height];
}

/**
 * Where the stock coordinate frame sits in work coordinates (ADR-0014,
 * ADR-0016). Geometry is stored in stock coordinates: `(0, 0)` is the stock's
 * bottom-left corner and `z = 0` its top, so changing the work origin never
 * moves the design on the stock.
 * Work coordinates have their origin where the stock's XY and Z origins say,
 * which is where the machine is zeroed and what G-code is written in.
 */
export function stockOffset(stock: Stock): Vec3 {
  const [x, y] = xyOriginPosition(stock, stock.xyOrigin);
  // `0 - 0` keeps a bottom-left zero at `0` rather than `-0`.
  return [0 - x, 0 - y, stock.zOrigin === "machine_bed" ? stock.thickness : 0];
}

/** The space the stock occupies, in stock coordinates. */
export function stockBox(stock: Pick<Stock, "width" | "height" | "thickness">): Box3 {
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
