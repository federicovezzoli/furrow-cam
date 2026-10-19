import type {
  Model,
  ModelPlacement,
  Point,
  QuarterTurn,
  Shape,
  Stock,
  StockAnchor,
} from "@furrow/document";
import { type Rect, shapesBounds } from "../geometry/bounds";
import { roundCoordinate } from "../geometry/round";
import { anchorPoint, type Box3, rectAlignment, type Vec3 } from "./stock";

/**
 * Placing imported 3D models on the stock (PRD-0005 S2, ADR-0031, ADR-0034).
 * A model's mesh is rotated in quarter turns, scaled the same in X and Y, its
 * Z scaled to its depth (in proportion, as edits keep it), and moved so its
 * top is at the stock top and its bounding box's bottom-left corner at its
 * position, all in stock coordinates.
 */

/** A model's mesh bounds and placement: all its placement depends on. */
export type PlacedModel = Pick<Model, "bounds" | "placement">;

export type Rotation = ModelPlacement["rotation"];

/** A rotation as a row-major 3 × 3 matrix; quarter turns only, so every entry is -1, 0 or 1. */
type Matrix3 = readonly number[];

const QUARTER_TURNS: readonly QuarterTurn[] = [0, 90, 180, 270];
const COS = { 0: 1, 90: 0, 180: -1, 270: 0 } as const;
const SIN = { 0: 0, 90: 1, 180: 0, 270: -1 } as const;

function turnMatrix(axis: 0 | 1 | 2, degrees: QuarterTurn): Matrix3 {
  const c = COS[degrees];
  const s = SIN[degrees];
  if (axis === 0) return [1, 0, 0, 0, c, -s, 0, s, c];
  if (axis === 1) return [c, 0, s, 0, 1, 0, -s, 0, c];
  return [c, -s, 0, s, c, 0, 0, 0, 1];
}

function multiply(a: Matrix3, b: Matrix3): Matrix3 {
  const product: number[] = [];
  for (let row = 0; row < 3; row++) {
    for (let column = 0; column < 3; column++) {
      let sum = 0;
      for (let k = 0; k < 3; k++) sum += (a[row * 3 + k] as number) * (b[k * 3 + column] as number);
      // `+ 0` turns -0 into 0, so equal rotations compare equal.
      product.push(sum + 0);
    }
  }
  return product;
}

/** The matrix of a placement's rotation: about X, then Y, then Z, each about the stock's axes. */
export function rotationMatrix([x, y, z]: Rotation): Matrix3 {
  return multiply(turnMatrix(2, z), multiply(turnMatrix(1, y), turnMatrix(0, x)));
}

/**
 * `rotation` followed by a quarter turn about the stock's `axis`, as the
 * three turns a placement stores. Of the turns that give the same rotation,
 * the first in order of X, then Y, then Z is chosen.
 */
export function turnModel(rotation: Rotation, axis: 0 | 1 | 2): Rotation {
  const target = multiply(turnMatrix(axis, 90), rotationMatrix(rotation));
  for (const x of QUARTER_TURNS) {
    for (const y of QUARTER_TURNS) {
      for (const z of QUARTER_TURNS) {
        const matrix = rotationMatrix([x, y, z]);
        if (matrix.every((value, i) => value === target[i])) return [x, y, z];
      }
    }
  }
  // Every quarter-turn rotation has a match among the 64.
  throw new Error("Unreachable: no quarter turns give this rotation");
}

/** The box around a mesh with `bounds` once rotated by `rotation`. */
export function rotatedBounds({ min, max }: Box3, rotation: Rotation): Box3 {
  const matrix = rotationMatrix(rotation);
  const rotatedMin: number[] = [];
  const rotatedMax: number[] = [];
  for (let row = 0; row < 3; row++) {
    let low = 0;
    let high = 0;
    for (let k = 0; k < 3; k++) {
      const factor = matrix[row * 3 + k] as number;
      if (factor === 0) continue;
      const a = factor * (min[k] as number);
      const b = factor * (max[k] as number);
      low += Math.min(a, b);
      high += Math.max(a, b);
    }
    rotatedMin.push(low + 0);
    rotatedMax.push(high + 0);
  }
  return { min: rotatedMin as Vec3, max: rotatedMax as Vec3 };
}

/** A rotated mesh's width, length and height, before scaling. */
export function rotatedSize(bounds: Box3, rotation: Rotation): Vec3 {
  const { min, max } = rotatedBounds(bounds, rotation);
  return [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
}

/** How much the Z of the rotated mesh is stretched to reach `depth`; flat meshes aren't. */
function depthScale(height: number, depth: number) {
  return height > 0 ? depth / height : 1;
}

/**
 * The depth that keeps a mesh with `bounds`, turned by `rotation` and scaled
 * by `scale`, in proportion: its height scaled like its outline. `null` for
 * a flat mesh, which has no depth to keep.
 */
export function proportionalDepth(bounds: Box3, rotation: Rotation, scale: number): number | null {
  const height = rotatedSize(bounds, rotation)[2];
  return height > 0 ? height * scale : null;
}

/** Where a placed model sits in the stock. A flat model sits on the stock top, with no depth. */
export function placedModelBox({ bounds, placement }: PlacedModel): Box3 {
  const [width, length, height] = rotatedSize(bounds, placement.rotation);
  const [x, y] = placement.position;
  return {
    min: [x, y, height > 0 ? -placement.depth : 0],
    max: [x + width * placement.scale, y + length * placement.scale, 0],
  };
}

/** A placed model's outline seen from above: its bounding rectangle in stock coordinates. */
export function modelRect(model: PlacedModel): Rect {
  const { min, max } = placedModelBox(model);
  return { min: [min[0], min[1]], max: [max[0], max[1]] };
}

/**
 * The affine transform from the mesh's file coordinates to stock
 * coordinates, as a row-major 3 × 4 matrix: each row holds the factors of
 * `x`, `y` and `z`, then the offset.
 */
export function modelTransform({ bounds, placement }: PlacedModel): number[] {
  const { rotation, scale, depth, position } = placement;
  const rotated = rotatedBounds(bounds, rotation);
  const scales: Vec3 = [scale, scale, depthScale(rotated.max[2] - rotated.min[2], depth)];
  const offset: Vec3 = [
    position[0] - scale * rotated.min[0],
    position[1] - scale * rotated.min[1],
    -scales[2] * rotated.max[2],
  ];
  return affine(rotationMatrix(rotation), scales, offset);
}

/**
 * The transform to a rotated mesh's own frame, before it is scaled and
 * moved: its bounding box's bottom-left corner at `(0, 0)` and its top at
 * `z = 0`. Scaling it by the placement's scale in X and Y and its depth
 * scale in Z, then moving it by the position, places it.
 */
export function rotatedFrameTransform(bounds: Box3, rotation: Rotation): number[] {
  const { min, max } = rotatedBounds(bounds, rotation);
  return affine(rotationMatrix(rotation), [1, 1, 1], [-min[0], -min[1], -max[2]]);
}

/** The scale of a placed model in X, Y and Z, from its rotated frame. */
export function placementScale({ bounds, placement }: PlacedModel): Vec3 {
  const height = rotatedSize(bounds, placement.rotation)[2];
  return [placement.scale, placement.scale, depthScale(height, placement.depth)];
}

function affine(rotation: Matrix3, scales: Vec3, offset: Vec3): number[] {
  const matrix: number[] = [];
  for (let row = 0; row < 3; row++) {
    const scale = scales[row] as number;
    for (let k = 0; k < 3; k++) matrix.push((rotation[row * 3 + k] as number) * scale + 0);
    matrix.push(offset[row] as number);
  }
  return matrix;
}

/**
 * The scale that fits a mesh rotated by `rotation` to the stock's width and
 * height, or `1` for a mesh with no width or length.
 */
export function fitScale(
  bounds: Box3,
  rotation: Rotation,
  { width, height }: Pick<Stock, "width" | "height">,
): number {
  const [x, y] = rotatedSize(bounds, rotation);
  const scales = [x > 0 ? width / x : Infinity, y > 0 ? height / y : Infinity];
  const scale = Math.min(...scales);
  return Number.isFinite(scale) ? scale : 1;
}

/**
 * The position that puts the `anchor` point of a model with `bounds`,
 * rotated and scaled as `placement` says, at `point`, rounded like stored
 * coordinates.
 */
export function positionAt(
  bounds: Box3,
  placement: Pick<ModelPlacement, "rotation" | "scale">,
  anchor: StockAnchor,
  [x, y]: Point,
): Point {
  const [width, length] = rotatedSize(bounds, placement.rotation);
  const [ax, ay] = anchorPoint(
    { min: [0, 0], max: [width * placement.scale, length * placement.scale] },
    anchor,
  );
  return [roundCoordinate(x - ax), roundCoordinate(y - ay)];
}

/** The border a new model leaves around it when fitted to the stock (ADR-0038), in millimetres. */
export const MODEL_BORDER = 10;

/**
 * The border left on every side of a model fitted to `stock`: `border`, but
 * never more than a quarter of the stock's smaller side.
 */
export function modelBorder(
  { width, height }: Pick<Stock, "width" | "height">,
  border = MODEL_BORDER,
): number {
  return Math.min(border, Math.min(width, height) / 4);
}

/**
 * The scale and position that fit a mesh rotated by `rotation` inside the
 * stock less its `modelBorder` for `border`, aligned to that inset rectangle
 * at `anchor` (ADR-0031, ADR-0038).
 */
export function stockFit(
  bounds: Box3,
  rotation: Rotation,
  stock: Pick<Stock, "width" | "height">,
  anchor: StockAnchor,
  border = MODEL_BORDER,
): Pick<ModelPlacement, "scale" | "position"> {
  const gap = modelBorder(stock, border);
  const inset: Rect = { min: [gap, gap], max: [stock.width - gap, stock.height - gap] };
  const scale = fitScale(bounds, rotation, {
    width: inset.max[0] - inset.min[0],
    height: inset.max[1] - inset.min[1],
  });
  return {
    scale,
    position: positionAt(bounds, { rotation, scale }, anchor, anchorPoint(inset, anchor)),
  };
}

/**
 * The placement of a newly imported mesh: unrotated, fitted inside the stock
 * less a border and aligned at `anchor` (`stockFit`), its depth what that
 * scale gives it, even deeper than the stock: a mesh is never stretched
 * (ADR-0034).
 */
export function initialPlacement(
  bounds: Box3,
  stock: Pick<Stock, "width" | "height" | "thickness">,
  anchor: StockAnchor,
): ModelPlacement {
  const rotation: Rotation = [0, 0, 0];
  const { scale, position } = stockFit(bounds, rotation, stock, anchor);
  const depth = proportionalDepth(bounds, rotation, scale) ?? stock.thickness;
  return { rotation, scale, depth, position };
}

/**
 * `placement` with a new rotation or scale, moved so that the model's point
 * at `anchor` stays where it is: a model aligned to the stock stays aligned.
 */
export function replacePlacement(
  model: PlacedModel,
  changes: Partial<Pick<ModelPlacement, "rotation" | "scale">>,
  anchor: StockAnchor,
): ModelPlacement {
  const next = { ...model.placement, ...changes };
  // The depth follows, so the mesh keeps its proportions (ADR-0034).
  next.depth = proportionalDepth(model.bounds, next.rotation, next.scale) ?? next.depth;
  const point = anchorPoint(modelRect(model), anchor);
  return { ...next, position: positionAt(model.bounds, next, anchor, point) };
}

/**
 * The bounding rectangle of the whole design: the drawing's shapes and the
 * placed models, or `null` if there are none. Anchors align it as one
 * (ADR-0031), so models keep their place relative to the drawing.
 */
export function designBounds(shapes: Shape[], models: readonly PlacedModel[]): Rect | null {
  let bounds = shapesBounds(shapes);
  for (const model of models) {
    const { min, max } = modelRect(model);
    bounds = bounds
      ? {
          min: [Math.min(bounds.min[0], min[0]), Math.min(bounds.min[1], min[1])],
          max: [Math.max(bounds.max[0], max[0]), Math.max(bounds.max[1], max[1])],
        }
      : { min, max };
  }
  return bounds;
}

/**
 * How far to move the whole design, drawing and models together, so its
 * bounding box sits on the stock at `anchor` (ADR-0022, ADR-0031).
 */
export function designAlignment(
  stock: Pick<Stock, "width" | "height">,
  shapes: Shape[],
  models: readonly PlacedModel[],
  anchor: StockAnchor,
): Point {
  return rectAlignment(stock, designBounds(shapes, models), anchor);
}

/**
 * The model whose outline seen from above holds `point`: the last one in
 * `models` where several overlap, as it was added last. `null` if none does.
 */
export function modelAt<T extends PlacedModel>(models: readonly T[], [x, y]: Point): T | null {
  for (let i = models.length - 1; i >= 0; i--) {
    const model = models[i] as T;
    const { min, max } = modelRect(model);
    if (x >= min[0] && x <= max[0] && y >= min[1] && y <= max[1]) return model;
  }
  return null;
}
