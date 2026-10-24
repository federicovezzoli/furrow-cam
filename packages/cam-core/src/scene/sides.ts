import type { FlipAxis, Stock } from "@furrow/document";
import { modelTransform, type PlacedModel } from "./model";
import type { Vec3 } from "./stock";

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
  stock: Pick<Stock, "width" | "height" | "thickness">,
  axis: FlipAxis,
  point: Vec3,
): Vec3 {
  return applyAffine(flipTransform(stock, axis), point);
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
  const flip = flipTransform(stock, axis);
  const placed = modelTransform(model);
  const matrix: number[] = [];
  for (let row = 0; row < 3; row++) {
    for (let column = 0; column < 4; column++) {
      let sum = column === 3 ? (flip[row * 4 + 3] as number) : 0;
      for (let k = 0; k < 3; k++) {
        sum += (flip[row * 4 + k] as number) * (placed[k * 4 + column] as number);
      }
      // `+ 0` turns -0 into 0, as `modelTransform` does.
      matrix.push(sum + 0);
    }
  }
  return matrix;
}

/** `point` moved by a row-major 3 × 4 affine `matrix`. */
export function applyAffine(matrix: readonly number[], [x, y, z]: Vec3): Vec3 {
  const row = (r: number) =>
    (matrix[r * 4] as number) * x +
    (matrix[r * 4 + 1] as number) * y +
    (matrix[r * 4 + 2] as number) * z +
    (matrix[r * 4 + 3] as number) +
    0;
  return [row(0), row(1), row(2)];
}
