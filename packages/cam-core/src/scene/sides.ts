import type {
  DrillOperation,
  FlipAxis,
  LinearAngle,
  LocatingPins,
  Model,
  Operation,
  Point,
  Shape,
  Stock,
  StockCorner,
} from "@furrow/document";
import { composeAffine } from "../geometry/affine";
import { roundCoordinate } from "../geometry/round";
import { mapShapes } from "../geometry/scale";
import { modelTransform, type PlacedModel, placedModelBox } from "./model";
import { type Box3, type Vec3, xyOriginPosition } from "./stock";

/**
 * The two sides of a two-sided project (PRD-0011, ADR-0060). The bottom
 * side's stock coordinates are the top side's once the stock is turned over
 * by half a turn about a line through its centre parallel to the flip axis:
 * `(0, 0)` is again the bottom-left corner of the face in view and `z = 0`
 * that face, so the zero and every helper of the top side apply unchanged.
 */

/**
 * The flip from one side's stock coordinates to the other's, as a row-major
 * 3 × 4 affine matrix like `modelTransform`. Half a turn is its own inverse,
 * so the same matrix maps either way.
 */
export function flipTransform(
  { width, height, thickness }: Pick<Stock, "width" | "height" | "thickness">,
  axis: FlipAxis,
): number[] {
  // About X, y and z change sign; about Y, x and z. The offsets keep the stock in place.
  return axis === "x"
    ? [1, 0, 0, 0, 0, -1, 0, height, 0, 0, -1, -thickness]
    : [-1, 0, 0, width, 0, 1, 0, 0, 0, 0, -1, -thickness];
}

/** `point` in one side's stock coordinates, in the other's. */
export function flipPoint(
  { width, height, thickness }: Pick<Stock, "width" | "height" | "thickness">,
  axis: FlipAxis,
  [x, y, z]: Vec3,
): Vec3 {
  // `+ 0` turns -0 into 0, as `flipTransform` gives.
  return axis === "x" ? [x, height - y, -thickness - z + 0] : [width - x, y, -thickness - z + 0];
}

/**
 * The transform from a model's file coordinates to the bottom side's stock
 * coordinates: the model as seen from below. Its placement is in the top
 * side's, so it reaches up from the bottom side's stock floor (ADR-0060).
 */
export function bottomModelTransform(
  model: PlacedModel,
  stock: Pick<Stock, "width" | "height" | "thickness">,
  axis: FlipAxis,
): number[] {
  return composeAffine(flipTransform(stock, axis), modelTransform(model));
}

/** The bottom side's flip: the stock's size and the axis it is turned over about. */
export type Flip = Pick<Stock, "width" | "height" | "thickness"> & { axis: FlipAxis };

/**
 * A model as one side sees it (ADR-0060): its mesh, the box it fills and the
 * transform from the mesh's file coordinates to that side's stock
 * coordinates. All a relief toolpath needs of it.
 */
export type ModelView = { sha256: string; box: Box3; transform: number[] };

/**
 * `model` as the top side sees it, or with `flip` as the bottom side does:
 * turned over, reaching up from the stock's floor. With a `parting` plane,
 * its box reaches down to it at least, so a side cuts down to the plane
 * around a model that doesn't (ADR-0060).
 */
export function modelView(
  model: PlacedModel & Pick<Model, "sha256">,
  flip: Flip | null = null,
  parting: number | null = null,
): ModelView {
  const placed = modelTransform(model);
  let { min, max } = placedModelBox(model);
  if (flip) {
    const corners = [flipPoint(flip, flip.axis, min), flipPoint(flip, flip.axis, max)];
    // Turned over, two of the corners' coordinates swap.
    min = [0, 1, 2].map((i) => Math.min(...corners.map((c) => c[i] as number))) as Vec3;
    max = [0, 1, 2].map((i) => Math.max(...corners.map((c) => c[i] as number))) as Vec3;
  }
  if (parting !== null && parting < min[2]) min = [min[0], min[1], parting];
  return {
    sha256: model.sha256,
    box: { min, max },
    transform: flip ? composeAffine(flipTransform(flip, flip.axis), placed) : placed,
  };
}

/** A point of the drawing, `[x, y]`, as the other side sees it, rounded like imported coordinates. */
export function flipPoint2(flip: Flip, [x, y]: Point): Point {
  const [fx, fy] = flipPoint(flip, flip.axis, [x, y, 0]);
  return [roundCoordinate(fx), roundCoordinate(fy)];
}

/**
 * `shapes` as the bottom side sees them (ADR-0060): mirrored about the flip
 * axis, arcs turning the other way. Toolpaths orient their paths
 * themselves, so a mirrored shape is cut as the top side would cut it.
 */
export function flipShapes(shapes: Shape[], flip: Flip): Shape[] {
  return mapShapes(shapes, (point) => flipPoint2(flip, point), true);
}

/**
 * `operation` as the bottom side sees it, mirrored with its drawing so it
 * cuts the same on the part: a profile's tabs at their mirrored places, and
 * a linear pocket's passes at the mirrored angle (45° and −45° swap).
 */
export function flipOperation(operation: Operation, flip: Flip): Operation {
  if (operation.type === "profile" && operation.params.tabs) {
    const { tabs } = operation.params;
    const positions = tabs.positions.map((point) => flipPoint2(flip, point));
    return { ...operation, params: { ...operation.params, tabs: { ...tabs, positions } } };
  }
  if (operation.type === "pocket" && operation.params.strategy.type === "linear") {
    const { angle } = operation.params.strategy;
    // A mirror turns every line's angle round the other way; 0° and 90° stay.
    const mirrored: LinearAngle = angle === 45 ? -45 : angle === -45 ? 45 : angle;
    const strategy = { type: "linear" as const, angle: mirrored };
    return { ...operation, params: { ...operation.params, strategy } };
  }
  return operation;
}

/**
 * The centres of the locating pins (#356) in stock coordinates, none without
 * any: on the line the stock turns about, so the same on either side and
 * where the turned-over stock's holes land.
 */
export function pinCenters({ width, height, twoSided }: Stock): Point[] {
  if (!twoSided?.pins) return [];
  const { flipAxis, pins } = twoSided;
  return pins.positions.map((position) =>
    flipAxis === "x" ? [width / 2 + position, height / 2] : [width / 2, height / 2 + position],
  );
}

/** How deep the pin holes go below the stock top: through it and into the spoilboard, or blind. */
export function pinDepth(thickness: number, { holes }: LocatingPins): number {
  return holes.type === "through" ? thickness + holes.spoilboardDepth : holes.depth;
}

/**
 * A drill operation as it cuts: a pin drill (#356) has the pin holes for
 * shapes, circles of the pins' diameter, and their depth; none in a project
 * without pins. Others keep their own.
 */
export function drillTargets(
  operation: DrillOperation,
  shapes: Shape[],
  stock: Stock,
): { operation: DrillOperation; shapes: Shape[] } {
  const pins = stock.twoSided?.pins;
  if (!operation.params.pins) return { operation, shapes };
  if (!pins) return { operation, shapes: [] };
  const r = pins.diameter / 2;
  const paths = pinCenters(stock).map(([x, y]) => {
    const start: Point = [x + r, y];
    return {
      start,
      segments: [{ kind: "arc" as const, to: start, center: [x, y] as Point, clockwise: false }],
      closed: true,
    };
  });
  const depth = pinDepth(stock.thickness, pins);
  return {
    operation: { ...operation, params: { ...operation.params, depth } },
    // Not a drawing's: only its paths are cut.
    shapes: [{ id: "locating-pins", name: "", layer: "", drawingId: "locating-pins", paths }],
  };
}

/**
 * Lining the stock up against its edges (#361): the corner pushed into the
 * fence corner on both sides, the XY zero's offset from it (the same on both
 * sides, each in its own stock coordinates), and the stock's size the sides
 * meet by: across the flip axis, which turning it over swaps end for end.
 * `null` without edges.
 */
export function edgeSetup(
  stock: Stock,
): { corner: StockCorner; offset: Point; across: "width" | "height" } | null {
  const corner = stock.twoSided?.edges;
  if (!corner) return null;
  const [x, y] = xyOriginPosition(stock);
  const cornerX = corner.endsWith("right") ? stock.width : 0;
  const cornerY = corner.startsWith("top") ? stock.height : 0;
  return {
    corner,
    // `+ 0` turns -0 into 0.
    offset: [x - cornerX + 0, y - cornerY + 0],
    across: stock.twoSided?.flipAxis === "x" ? "height" : "width",
  };
}
