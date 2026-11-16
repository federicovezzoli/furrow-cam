import type { HoldingTabs, Model, Point, Stock } from "@furrow/document";
import { type PlacedModel, placedModelBox } from "../scene/model";
import { walkInward } from "../simulation/grid-walk";
import type { Heightmap } from "../simulation/simulation";
import { previewEmpty } from "./relief/mesh-raster";
import { loopLength, nearestOnLoops, pointAlong, spreadAlong } from "./tabs";

/**
 * Holding tabs of a two-sided project (PRD-0011 B5, ADR-0063): strips of
 * material the 3D operations leave between the part and the stock around it,
 * at the parting plane.
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

/** `count` tab positions round each of `models`' outlines, evenly, half a gap from its corner. */
export function autoHoldingTabPositions(models: readonly PlacedModel[], count: number): Point[] {
  return modelOutlines(models).flatMap((loop) => spreadAlong(loop, count));
}

/**
 * Tab `positions` kept at the same place round their models' outlines, as
 * a share of the way round, once the models change from `before` to `after`
 * (the same models in the same order): moved, turned or scaled.
 */
export function followModels(
  positions: readonly Point[],
  before: readonly PlacedModel[],
  after: readonly PlacedModel[],
): Point[] {
  const from = modelOutlines(before);
  const to = modelOutlines(after);
  return positions.map((position) => {
    const nearest = nearestOnLoops(from, position);
    const was = nearest && from[nearest.loop];
    const loop = nearest && to[nearest.loop];
    if (!nearest || !was || !loop) return position;
    const share = nearest.at / (loopLength(was) || 1);
    return pointAlong(loop, share * loopLength(loop));
  });
}

/**
 * Where a tab leaves material, in the top side's stock coordinates: `at` is
 * on the outline of the model `modelId`, nearest the tab's position, and the
 * strip runs from there along the outline's outward normal to `to`, the
 * stock's edge or the first other model in the way. The 3D operations of
 * either side carry it on inward to the model's surface (`reachModel`).
 */
export type HoldingTabStrip = { modelId: string; at: Point; to: Point };

/** The strips of `tabs`, one per position; none without models. */
export function holdingTabStrips(
  stock: Pick<Stock, "width" | "height">,
  models: readonly (PlacedModel & Pick<Model, "id">)[],
  tabs: Pick<HoldingTabs, "positions" | "width">,
): HoldingTabStrip[] {
  const loops = modelOutlines(models);
  return tabs.positions.flatMap((position) => {
    const nearest = nearestOnLoops(loops, position);
    const model = nearest && models[nearest.loop];
    if (!nearest || !model) return [];
    const { point: at, tangent } = nearest;
    // Right of a counter-clockwise outline's direction: outwards.
    const normal: Point = [tangent[1], -tangent[0]];
    // Wherever the strip, as wide as the tab, would reach another model.
    const others = loops
      .filter((_, i) => i !== nearest.loop)
      .map((loop) => entryDistance(loop, at, normal, tabs.width / 2));
    const outward = Math.max(0, Math.min(exitDistance(stock, at, normal), ...others));
    return [
      { modelId: model.id, at, to: [at[0] + normal[0] * outward, at[1] + normal[1] * outward] },
    ];
  });
}

/**
 * `strip` carried on inward to the model's surface as its `preview` shows it
 * (`modelHeightmap`, uncovered cells at `previewEmpty`), for drawing the tab as
 * the 3D operations leave it (`reachModel`, #608). A strip whose way in meets
 * no part of the model, or with no direction, is left as it is.
 */
export function reachPreview(
  strip: HoldingTabStrip,
  model: PlacedModel,
  { heights, ...grid }: Heightmap,
): HoldingTabStrip {
  const { at, to } = strip;
  const length = Math.hypot(at[0] - to[0], at[1] - to[1]);
  if (length === 0) return strip;
  const [du, dv] = [(at[0] - to[0]) / length, (at[1] - to[1]) / length];
  const { min } = placedModelBox(model);
  const scale = model.placement.scale;
  const empty = previewEmpty(model.bounds, model.placement.rotation);
  // In the preview's frame: unscaled, from the box's corner.
  const start: Point = [(at[0] - min[0]) / scale, (at[1] - min[1]) / scale];
  const hit = walkInward(grid, start, [du, dv], (cell) => (heights[cell] as number) > empty);
  if (!hit || hit.steps === 0) return strip;
  return { ...strip, at: [min[0] + hit.point[0] * scale, min[1] + hit.point[1] * scale] };
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

/**
 * How far from `point` along the unit `direction` a ray meets the box of
 * `outline` grown by `margin`, `Infinity` if it never does.
 */
function entryDistance(outline: Point[], [x, y]: Point, [dx, dy]: Point, margin: number): number {
  const [min, , max] = outline as [Point, Point, Point];
  let enter = 0;
  let leave = Infinity;
  for (const [p, d, low, high] of [
    [x, dx, min[0] - margin, max[0] + margin],
    [y, dy, min[1] - margin, max[1] + margin],
  ] as const) {
    if (d === 0) {
      if (p < low || p > high) return Infinity;
      continue;
    }
    const [a, b] = [(low - p) / d, (high - p) / d];
    enter = Math.max(enter, Math.min(a, b));
    leave = Math.min(leave, Math.max(a, b));
  }
  return enter <= leave ? enter : Infinity;
}
