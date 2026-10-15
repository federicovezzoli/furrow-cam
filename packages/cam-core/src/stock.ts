import type { Point, Shape, Stock, StockAnchor } from "@furrow/document";
import { type Rect, shapesBounds } from "./bounds";
import { roundCoordinate } from "./import-common";
import { translateShapes } from "./translate";

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
} as const satisfies Record<StockAnchor, readonly [number, number]>;

/** The point of `rect` that `anchor` names, e.g. its top-right corner. */
export function anchorPoint({ min, max }: Rect, anchor: StockAnchor): Point {
  const [fx, fy] = ANCHOR_FRACTIONS[anchor];
  return [min[0] + fx * (max[0] - min[0]), min[1] + fy * (max[1] - min[1])];
}

/**
 * The XY zero in stock coordinates. Anchors follow the stock's size; a custom
 * zero is already in stock coordinates.
 */
export function xyOriginPosition({
  width,
  height,
  xyOrigin: origin,
}: Pick<Stock, "width" | "height" | "xyOrigin">): [number, number] {
  if (origin.anchor === "custom") return [origin.x, origin.y];
  return anchorPoint({ min: [0, 0], max: [width, height] }, origin.anchor);
}

/**
 * How far to move `shapes` so their bounding box sits on the stock at
 * `anchor` (ADR-0022): `bottom_left` puts the drawing's bottom-left corner on
 * the stock's, `center` centres it on the stock. `[0, 0]` if there are no
 * shapes or they are aligned already.
 */
export function anchorAlignment(
  stock: Pick<Stock, "width" | "height">,
  shapes: Shape[],
  anchor: StockAnchor,
): Point {
  return rectAlignment(stock, shapesBounds(shapes), anchor);
}

/** How far to move `bounds` to sit on the stock at `anchor`, like `anchorAlignment`. */
export function rectAlignment(
  stock: Pick<Stock, "width" | "height">,
  bounds: Rect | null,
  anchor: StockAnchor,
): Point {
  if (!bounds) return [0, 0];
  const [x, y] = anchorPoint({ min: [0, 0], max: [stock.width, stock.height] }, anchor);
  const [bx, by] = anchorPoint(bounds, anchor);
  // Rounded like stored coordinates, so an aligned drawing's offset is exactly `0`.
  return [roundCoordinate(x - bx), roundCoordinate(y - by)];
}

/**
 * How far the XY zero moves on the stock from `before` to `after`, rounded
 * like stored coordinates: what moves a drawing with an anchored zero when
 * the stock is resized (ADR-0022).
 */
export function xyOriginShift(
  before: Pick<Stock, "width" | "height" | "xyOrigin">,
  after: Pick<Stock, "width" | "height" | "xyOrigin">,
): Point {
  const [x0, y0] = xyOriginPosition(before);
  const [x1, y1] = xyOriginPosition(after);
  return [roundCoordinate(x1 - x0), roundCoordinate(y1 - y0)];
}

/**
 * Where the stock coordinate frame sits in work coordinates (ADR-0014,
 * ADR-0016). Geometry is stored in stock coordinates: `(0, 0)` is the stock's
 * bottom-left corner and `z = 0` its top.
 * Work coordinates have their origin where the stock's XY and Z origins say,
 * which is where the machine is zeroed and what G-code is written in.
 */
export function stockOffset(stock: Stock): Vec3 {
  const [x, y] = xyOriginPosition(stock);
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

/** `shapes` aligned to the stock at `anchor` (see `anchorAlignment`): the same array if they already are. */
export function alignShapes(
  stock: Pick<Stock, "width" | "height">,
  shapes: Shape[],
  anchor: StockAnchor,
): Shape[] {
  return translateShapes(shapes, anchorAlignment(stock, shapes, anchor));
}
