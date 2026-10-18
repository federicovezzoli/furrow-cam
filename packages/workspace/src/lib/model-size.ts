import { formatQuantity, rotatedSize, unitLabel } from "@furrow/cam-core";
import type { Model, Units } from "@furrow/document";

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
