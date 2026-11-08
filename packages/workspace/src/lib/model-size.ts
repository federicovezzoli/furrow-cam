import {
  type Box3,
  formatQuantity,
  modelBorder,
  rotatedSize,
  stockFit,
  unitLabel,
} from "@furrow/cam-core";
import { MODEL_BORDER, type Model, type Stock, type Units } from "@furrow/document";

/**
 * A model's size in its file, turned like the model so its axes match the
 * Width, Height and Depth fields, in the project's units (`120 × 80 × 15 mm`),
 * and its scale in percent, rounded to a tenth. STL has no units, so file
 * coordinates are millimetres, as on import.
 */
export function originalSize(
  { bounds, placement }: Pick<Model, "bounds" | "placement">,
  units: Units,
): { size: string; scale: number } {
  const size = rotatedSize(bounds, placement.rotation)
    .map((extent) => formatQuantity(extent, "length", units))
    .join(" × ");
  return {
    size: `${size} ${unitLabel("length", units)}`,
    scale: Math.round(placement.scale * 1000) / 10,
  };
}

/**
 * The border the next *Fit to stock* leaves when the cap (a quarter of the
 * stock's smaller side) applies, as text, or `null` when `border` is left as is.
 */
export function cappedBorder(
  border: number,
  stock: Pick<Stock, "width" | "height">,
  units: Units,
): string | null {
  const applied = modelBorder(stock, border);
  if (applied >= border) return null;
  return `${formatQuantity(applied, "length", units)} ${unitLabel("length", units)}`;
}

/**
 * The longest side, in mm, of a model with the proportions of an area
 * `width` × `depth` that fits inside the stock less the model border, as
 * *Fit to stock* would place it (PRD-0014 T4).
 */
export function fittingSide(
  stock: Pick<Stock, "width" | "height">,
  [width, depth]: readonly [number, number],
): number {
  const bounds: Box3 = { min: [0, 0, 0], max: [width, depth, 0] };
  const { scale } = stockFit(bounds, [0, 0, 0], stock, "center", MODEL_BORDER);
  return Math.max(width, depth) * scale;
}
