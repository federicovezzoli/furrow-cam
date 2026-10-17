import type { Stock, TouchOff, TouchOffDisc } from "@furrow/document";
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
  { x, y, diameter }: TouchOffDisc,
): boolean {
  const r = diameter / 2;
  return x - r < 0 || y - r < 0 || x + r > width || y + r > height;
}

/**
 * `pad` moved the least it takes to be wholly on the stock, its diameter and
 * tool change kept: no larger than the stock's smaller side, it always fits.
 */
export function clampTouchOff(
  { width, height }: Pick<Stock, "width" | "height">,
  pad: TouchOff,
): TouchOff {
  const r = pad.diameter / 2;
  const clamp = (value: number, size: number) =>
    roundCoordinate(Math.min(Math.max(value, r), size - r));
  return { ...pad, x: clamp(pad.x, width), y: clamp(pad.y, height) };
}

/**
 * A new pad for `stock`, `diameter` across (by default `DEFAULT_TOUCH_OFF_DIAMETER`,
 * no wider than the stock's smaller side), centred on the XY zero (ADR-0043):
 * the tool goes back to X0 Y0 at each tool change. A zero on the stock's
 * edge, or off it, leaves part of the pad off the stock.
 */
export function defaultTouchOff(
  stock: Pick<Stock, "width" | "height" | "xyOrigin">,
  diameter = Math.min(DEFAULT_TOUCH_OFF_DIAMETER, stock.width, stock.height),
): TouchOff {
  const [x, y] = xyOriginPosition(stock);
  return { x: roundCoordinate(x), y: roundCoordinate(y), diameter, toolChange: null };
}
