import type { FlipAxis, Model, Stock } from "@furrow/document";
import { applyAffine, composeAffine } from "../geometry/affine";
import { modelTransform, type PlacedModel, placedModelBox } from "./model";
import type { Box3, Vec3 } from "./stock";

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

/**
 * A model as one side sees it (ADR-0060): its mesh, the box it fills and the
 * transform from the mesh's file coordinates to that side's stock
 * coordinates. All a relief toolpath needs of it.
 */
export type ModelView = { sha256: string; box: Box3; transform: number[] };

/**
 * `model` as the top side sees it, or with `flip` (`flipTransform`) as the
 * bottom side does: turned over, reaching up from the stock's floor.
 */
export function modelView(
  model: PlacedModel & Pick<Model, "sha256">,
  flip: readonly number[] | null = null,
): ModelView {
  const placed = modelTransform(model);
  const box = placedModelBox(model);
  if (!flip) return { sha256: model.sha256, box, transform: placed };
  // The flip only turns axes over, so the box's corners stay its corners.
  const a = applyAffine(flip, box.min);
  const b = applyAffine(flip, box.max);
  return {
    sha256: model.sha256,
    box: {
      min: [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2])],
      max: [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])],
    },
    transform: composeAffine(flip, placed),
  };
}
