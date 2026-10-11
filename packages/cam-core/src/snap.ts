import {
  distance,
  type Point,
  pointsCoincide,
  type Shape,
  type Stock,
  type StockAnchor,
} from "@furrow/document";
import { circleCenter } from "./drill";
import { flattenPath } from "./flatten";
import { xyOriginPosition } from "./stock";

/**
 * What a snap target is (PRD-0002 Z5): a stock anchor, a vertex of a shape (a
 * segment end, or a single-point path), the centre of an arc or of a circle
 * (a closed path drilling would take as one, see `circleCenter`), or a corner
 * or the centre of a shape's bounding box.
 */
export type SnapKind =
  | "stock_anchor"
  | "vertex"
  | "arc_center"
  | "circle_center"
  | "bounds_corner"
  | "bounds_center";

/** A point the cursor snaps to, in stock coordinates (ADR-0014). */
export type SnapTarget =
  | { kind: "stock_anchor"; anchor: StockAnchor; point: Point }
  | { kind: Exclude<SnapKind, "stock_anchor">; point: Point };

const STOCK_ANCHORS: StockAnchor[] = [
  "bottom_left",
  "bottom_center",
  "bottom_right",
  "middle_left",
  "center",
  "middle_right",
  "top_left",
  "top_center",
  "top_right",
];

/**
 * Every point a picked XY zero can snap to, in stock coordinates. Where
 * targets coincide, the earlier one wins in `nearestSnapTarget`, and the list
 * goes from the most specific: stock anchors, then circle centres, vertices,
 * arc centres, bounding-box corners and centres.
 */
export function snapTargets(stock: Pick<Stock, "width" | "height">, shapes: Shape[]): SnapTarget[] {
  const targets: SnapTarget[] = STOCK_ANCHORS.map((anchor) => ({
    kind: "stock_anchor",
    anchor,
    point: xyOriginPosition({ ...stock, xyOrigin: { anchor } }),
  }));
  const vertices: SnapTarget[] = [];
  const arcCenters: SnapTarget[] = [];
  const bounds: SnapTarget[] = [];
  for (const shape of shapes) {
    let min: Point = [Infinity, Infinity];
    let max: Point = [-Infinity, -Infinity];
    for (const path of shape.paths) {
      const center = circleCenter(path);
      if (center) targets.push({ kind: "circle_center", point: center });
      vertices.push({ kind: "vertex", point: path.start });
      for (const segment of path.segments) {
        vertices.push({ kind: "vertex", point: segment.to });
        if (segment.kind === "arc" && !center) {
          arcCenters.push({ kind: "arc_center", point: segment.center });
        }
      }
      // Flattened, so curves bulging past their end points count.
      for (const [x, y] of flattenPath(path)) {
        min = [Math.min(min[0], x), Math.min(min[1], y)];
        max = [Math.max(max[0], x), Math.max(max[1], y)];
      }
    }
    const [cx, cy] = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2];
    for (const point of [min, [max[0], min[1]], max, [min[0], max[1]]] as Point[]) {
      bounds.push({ kind: "bounds_corner", point });
    }
    bounds.push({ kind: "bounds_center", point: [cx, cy] });
  }
  return [...targets, ...vertices, ...arcCenters, ...bounds];
}

/**
 * The target of `targets` nearest to `point` and at most `radius` away, or
 * `null`. Of coinciding targets (see `pointsCoincide`), the earliest
 * wins.
 */
export function nearestSnapTarget(
  targets: SnapTarget[],
  point: Point,
  radius: number,
): SnapTarget | null {
  let best: SnapTarget | null = null;
  let bestDistance = Infinity;
  for (const target of targets) {
    const d = distance(target.point, point);
    if (d > radius || d >= bestDistance) continue;
    if (!best || !pointsCoincide(best.point, target.point)) {
      best = target;
      bestDistance = d;
    }
  }
  return best;
}
