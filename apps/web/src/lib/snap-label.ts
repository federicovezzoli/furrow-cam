import { formatQuantity, type SnapTarget, unitLabel } from "@furrow/cam-core";
import type { Point, Units } from "@furrow/document";
import { ANCHOR_LABELS } from "./anchor-grid";

const KIND_LABELS: Record<Exclude<SnapTarget["kind"], "stock_anchor">, string> = {
  vertex: "Vertex",
  arc_center: "Arc centre",
  circle_center: "Circle centre",
  bounds_corner: "Bounding box corner",
  bounds_center: "Bounding box centre",
};

/** What the cursor is on while picking the zero: a snap target, or `null` for a free point. */
export function snapLabel(target: SnapTarget | null): string {
  if (!target) return "Point";
  if (target.kind === "stock_anchor") return `Stock ${ANCHOR_LABELS[target.anchor].toLowerCase()}`;
  return KIND_LABELS[target.kind];
}

/**
 * A point in stock coordinates as the custom zero's X and Y fields show it:
 * from the stock's bottom-left corner, in the project's units.
 */
export function pointLabel([x, y]: Point, units: Units): string {
  const unit = unitLabel("length", units);
  const format = (value: number) => `${formatQuantity(value, "length", units)} ${unit}`;
  return `X ${format(x)}, Y ${format(y)}`;
}
