import { formatQuantity, modelBorder, rotatedSize, unitLabel } from "@furrow/cam-core";
import type { Model, Stock, Units } from "@furrow/document";

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
