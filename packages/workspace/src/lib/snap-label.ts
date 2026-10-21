import { formatQuantity, type SnapTarget, unitLabel } from "@furrow/cam-core";
import type { Point, Units } from "@furrow/document";
import { localizeDecimal } from "@furrow/ui/lib/locales";

/**
 * The catalog key, under `Snap`, of what the cursor is on while picking the
 * zero: a snap target, or a free point.
 */
export function snapKey(target: SnapTarget | null) {
  if (!target) return "point" as const;
  if (target.kind === "stock_anchor") return `anchors.${target.anchor}` as const;
  return target.kind;
}

/**
 * A point in stock coordinates as the custom zero's X and Y fields show it:
 * from the stock's bottom-left corner, in the project's units and `locale`'s decimals.
 */
export function pointLabel([x, y]: Point, units: Units, locale = "en"): string {
  const unit = unitLabel("length", units);
  const format = (value: number) =>
    `${localizeDecimal(formatQuantity(value, "length", units), locale)} ${unit}`;
  return `X ${format(x)}, Y ${format(y)}`;
}
