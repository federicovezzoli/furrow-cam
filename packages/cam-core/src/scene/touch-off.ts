import type { Point, Stock, TouchOff } from "@furrow/document";
import type { Rect } from "../geometry/bounds";
import { roundCoordinate } from "../geometry/round";
import { xyOriginPosition } from "./stock";

/**
 * The touch-off pad (#147, ADR-0041): a disc of the stock top no operation
 * cuts, for zeroing Z on after a tool change.
 */

/** The diameter of a new touch-off pad, in millimetres. */
export const DEFAULT_TOUCH_OFF_DIAMETER = 15;

/** The pad operations must leave alone: the stock's, with the Z zero on the stock top. */
export function activeTouchOff(stock: Pick<Stock, "zOrigin" | "touchOff">): TouchOff | null {
  return stock.zOrigin === "stock_top" ? stock.touchOff : null;
}

/** Whether `pad` reaches past the stock's edges, so some of it isn't there to touch off on. */
export function touchOffOutsideStock(
  { width, height }: Pick<Stock, "width" | "height">,
  { x, y, diameter }: TouchOff,
): boolean {
  const r = diameter / 2;
  return x - r < 0 || y - r < 0 || x + r > width || y + r > height;
}

/**
 * `pad` moved the least it takes to be wholly on the stock, its diameter
 * kept: no larger than the stock's smaller side, it always fits.
 */
export function clampTouchOff(
  { width, height }: Pick<Stock, "width" | "height">,
  { x, y, diameter }: TouchOff,
): TouchOff {
  const r = diameter / 2;
  const clamp = (value: number, size: number) =>
    roundCoordinate(Math.min(Math.max(value, r), size - r));
  return { x: clamp(x, width), y: clamp(y, height), diameter };
}

/**
 * A new pad for `stock`, `diameter` across (by default `DEFAULT_TOUCH_OFF_DIAMETER`,
 * no wider than the stock's smaller side): at the stock corner nearest the
 * XY zero that the design's bounding box `design` doesn't cover, inset by
 * half the diameter so the pad is on the stock. A corner where the whole
 * pad is clear of the design comes first; then one whose corner point is
 * clear; then the nearest corner. Between corners as near as each other,
 * bottom ones come first, then left ones.
 */
export function defaultTouchOff(
  stock: Pick<Stock, "width" | "height" | "xyOrigin">,
  design: Rect | null,
  diameter = Math.min(DEFAULT_TOUCH_OFF_DIAMETER, stock.width, stock.height),
): TouchOff {
  const { width, height } = stock;
  const r = diameter / 2;
  const [zx, zy] = xyOriginPosition(stock);
  // In order of preference where two are as near: bottom first, then left.
  const corners: Point[] = [
    [0, 0],
    [width, 0],
    [0, height],
    [width, height],
  ];
  corners.sort((a, b) => Math.hypot(a[0] - zx, a[1] - zy) - Math.hypot(b[0] - zx, b[1] - zy));
  const centre = ([x, y]: Point): Point => [x === 0 ? r : x - r, y === 0 ? r : y - r];
  const overlaps = (min: Point, max: Point) =>
    design !== null &&
    min[0] < design.max[0] &&
    max[0] > design.min[0] &&
    min[1] < design.max[1] &&
    max[1] > design.min[1];
  const clearPad = corners.find((corner) => {
    const [x, y] = centre(corner);
    return !overlaps([x - r, y - r], [x + r, y + r]);
  });
  const clearCorner = corners.find(
    ([x, y]) =>
      design === null ||
      !(x >= design.min[0] && x <= design.max[0] && y >= design.min[1] && y <= design.max[1]),
  );
  const [x, y] = centre(clearPad ?? clearCorner ?? (corners[0] as Point));
  return { x: roundCoordinate(x), y: roundCoordinate(y), diameter };
}
