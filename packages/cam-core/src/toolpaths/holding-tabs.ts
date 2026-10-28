import type { HoldingTabs, Point, Stock } from "@furrow/document";
import { type Projection, projectOnLoop } from "../geometry/loop";
import { type PlacedModel, placedModelBox } from "../scene/model";
import { loopLength, pointAlong } from "./tabs";

/**
 * Holding tabs of a two-sided project (PRD-0011 B5, ADR-0063): strips of
 * material the bottom side's 3D operations leave between the part and the
 * stock around it, at the parting plane.
 */

/**
 * The outline of each model seen from above, in the top side's stock
 * coordinates: its box, counter-clockwise from its lower-left corner and
 * ending there. Tabs are spread and dragged along these.
 */
export function modelOutlines(models: readonly PlacedModel[]): Point[][] {
  return models.map((model) => {
    const { min, max } = placedModelBox(model);
    return [
      [min[0], min[1]],
      [max[0], min[1]],
      [max[0], max[1]],
      [min[0], max[1]],
      [min[0], min[1]],
    ];
  });
}

/** `count` tab positions around each of `models`' outlines, evenly, half a gap from its corner. */
export function autoHoldingTabPositions(models: readonly PlacedModel[], count: number): Point[] {
  return modelOutlines(models).flatMap((loop) => {
    const length = loopLength(loop);
    if (length === 0) return [];
    return Array.from({ length: count }, (_, i) => pointAlong(loop, ((i + 0.5) * length) / count));
  });
}

/**
 * Where a tab leaves material, in the top side's stock coordinates: `at` is
 * on the nearest model's outline, and the strip runs along the outline's
 * outward normal there, from `from`, the middle of the model's box (a tab
 * holds the model wherever its surface is lower than the tab's top, however
 * far inside its box that is), to `to`, the stock's edge.
 */
export type HoldingTabStrip = { at: Point; from: Point; to: Point };

/** The strips of `tabs`, one per position; none without models. */
export function holdingTabStrips(
  stock: Pick<Stock, "width" | "height">,
  models: readonly PlacedModel[],
  tabs: Pick<HoldingTabs, "positions">,
): HoldingTabStrip[] {
  const loops = modelOutlines(models);
  return tabs.positions.flatMap((position) => {
    let best: { loop: Point[]; projection: Projection } | null = null;
    for (const loop of loops) {
      const projection = projectOnLoop(loop, position);
      if (!best || projection.distance < best.projection.distance) best = { loop, projection };
    }
    if (!best) return [];
    const { point: at, tangent } = best.projection;
    // Right of a counter-clockwise outline's direction: outwards.
    const normal: Point = [tangent[1], -tangent[0]];
    const [min, , max] = best.loop as [Point, Point, Point];
    const inward =
      (Math.abs(normal[0]) * (max[0] - min[0]) + Math.abs(normal[1]) * (max[1] - min[1])) / 2;
    const outward = Math.max(0, exitDistance(stock, at, normal));
    return [
      {
        at,
        from: [at[0] - normal[0] * inward, at[1] - normal[1] * inward],
        to: [at[0] + normal[0] * outward, at[1] + normal[1] * outward],
      },
    ];
  });
}

/** How far from `point` along the unit `direction` the stock's edge is. */
function exitDistance(
  { width, height }: Pick<Stock, "width" | "height">,
  [x, y]: Point,
  [dx, dy]: Point,
): number {
  const along = (p: number, d: number, size: number) =>
    d > 0 ? (size - p) / d : d < 0 ? -p / d : Infinity;
  return Math.min(along(x, dx, width), along(y, dy, height));
}
