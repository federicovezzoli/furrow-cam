import { formatQuantity, modelBorder, rotatedSize, unitLabel } from "@furrow/cam-core";
import type { Model, Stock, Units } from "@furrow/document";

/**
 * A model's size in its file, turned like the model so its axes match the
 * Width, Height and Depth fields, and its scale, in the project's units:
 * `Original: 120 × 80 × 15 mm (scale 42%)`. STL has no units, so file
 * coordinates are millimetres, as on import.
 */
export function originalSizeLabel(
  { bounds, placement }: Pick<Model, "bounds" | "placement">,
  units: Units,
): string {
  const size = rotatedSize(bounds, placement.rotation)
    .map((extent) => formatQuantity(extent, "length", units))
    .join(" × ");
  const percent = (placement.scale * 100).toLocaleString("en-US", { maximumFractionDigits: 1 });
  return `Original: ${size} ${unitLabel("length", units)} (scale ${percent}%)`;
}

/**
 * What the Border field does: it applies on the next *Fit to stock*, without
 * moving the model now, and is capped at a quarter of the stock's smaller
 * side, said with the border the fit leaves when the cap applies.
 */
export function borderNote(
  border: number,
  stock: Pick<Stock, "width" | "height">,
  units: Units,
): string {
  const applied = modelBorder(stock, border);
  const note = "Left on every side by the next Fit to stock; editing it doesn't move the model.";
  if (applied >= border) return note;
  const capped = `${formatQuantity(applied, "length", units)} ${unitLabel("length", units)}`;
  return `${note} On this stock it leaves ${capped}, a quarter of its smaller side.`;
}
