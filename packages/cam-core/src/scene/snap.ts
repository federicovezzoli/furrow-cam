import {
  distance,
  type Path,
  type Point,
  pointsCoincide,
  type Shape,
  type Stock,
  StockAnchor,
} from "@furrow/document";
import { shapesBounds } from "../geometry/bounds";
import { circleCenter } from "../geometry/circle";
import { arcSweep, flattenPath } from "../geometry/flatten";
import { projectOnLoop } from "../geometry/loop";
import { xyOriginPosition } from "./stock";

/**
 * What a snap target is (PRD-0002 Z5): a stock anchor, a vertex of a shape (a
 * segment end, or a single-point path), the centre of an arc or of a circle
 * (a closed path drilling would take as one, see `circleCenter`), or a corner
 * or the centre of a shape's bounding box. Placed drill holes (#429) also
 * snap to the middle of a segment and to the nearest point of an edge.
 */
export type SnapKind =
  | "stock_anchor"
  | "vertex"
  | "arc_center"
  | "circle_center"
  | "bounds_corner"
  | "bounds_center"
  | "midpoint"
  | "edge";

/** A point the cursor snaps to, in stock coordinates (ADR-0014). */
export type SnapTarget =
  | { kind: "stock_anchor"; anchor: StockAnchor; point: Point }
  | { kind: Exclude<SnapKind, "stock_anchor">; point: Point };

/**
 * Every point a picked XY zero can snap to, in stock coordinates. Where
 * targets coincide, the earlier one wins in `nearestSnapTarget`, and the list
 * goes from the most specific: stock anchors, then circle centres, vertices,
 * arc centres, bounding-box corners and centres.
 */
export function snapTargets(stock: Pick<Stock, "width" | "height">, shapes: Shape[]): SnapTarget[] {
  const targets: SnapTarget[] = StockAnchor.options.map((anchor) => ({
    kind: "stock_anchor",
    anchor,
    point: xyOriginPosition({ ...stock, xyOrigin: { anchor } }),
  }));
  const vertices: SnapTarget[] = [];
  const arcCenters: SnapTarget[] = [];
  const bounds: SnapTarget[] = [];
  for (const shape of shapes) {
    for (const path of shape.paths) {
      const loop = flattenPath(path);
      const center = circleCenter(path, loop);
      if (center) targets.push({ kind: "circle_center", point: center });
      vertices.push({ kind: "vertex", point: path.start });
      for (const segment of path.segments) {
        vertices.push({ kind: "vertex", point: segment.to });
        if (segment.kind === "arc" && !center) {
          arcCenters.push({ kind: "arc_center", point: segment.center });
        }
      }
    }
    // Exact, like the box the drawing is aligned by (ADR-0022): curves bulging past their ends count.
    const box = shapesBounds([shape]);
    if (!box) continue;
    const { min, max } = box;
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
    // A coinciding later target is as near as `best`, which stays.
    if (!best || !pointsCoincide(best.point, target.point)) best = target;
    bestDistance = d;
  }
  return best;
}

/**
 * Every point a placed drill hole (#429) can snap to: `snapTargets`, then
 * the middle of every segment (along the curve for an arc, at half its
 * parameter for a Bézier), a closed path's closing line included.
 */
export function holeSnapTargets(
  stock: Pick<Stock, "width" | "height">,
  shapes: Shape[],
): SnapTarget[] {
  const midpoints = shapes.flatMap((shape) => shape.paths.flatMap(segmentMidpoints));
  return [
    ...snapTargets(stock, shapes),
    ...midpoints.map((point): SnapTarget => ({ kind: "midpoint", point })),
  ];
}

/** The paths of `shapes` with segments, flattened, for `nearestHoleSnap`. */
export function snapEdges(shapes: Shape[]): Point[][] {
  return shapes.flatMap((shape) =>
    shape.paths.filter((path) => path.segments.length > 0).map((path) => flattenPath(path)),
  );
}

/**
 * Where a placed drill hole snaps near `point`: the nearest of `targets`
 * within `radius`, or else the nearest point of `edges` (from `snapEdges`)
 * within it, or `null`.
 */
export function nearestHoleSnap(
  targets: SnapTarget[],
  edges: Point[][],
  point: Point,
  radius: number,
): SnapTarget | null {
  const target = nearestSnapTarget(targets, point, radius);
  if (target) return target;
  let best: SnapTarget | null = null;
  let bestDistance = radius;
  for (const edge of edges) {
    const projection = projectOnLoop(edge, point);
    if (projection.distance > bestDistance) continue;
    best = { kind: "edge", point: projection.point };
    bestDistance = projection.distance;
  }
  return best;
}

function segmentMidpoints(path: Path): Point[] {
  const points: Point[] = [];
  let from = path.start;
  for (const segment of path.segments) {
    const { to } = segment;
    if (segment.kind === "line") points.push(middle(from, to));
    else if (segment.kind === "cubic") {
      const { c1, c2 } = segment;
      points.push([
        (from[0] + 3 * c1[0] + 3 * c2[0] + to[0]) / 8,
        (from[1] + 3 * c1[1] + 3 * c2[1] + to[1]) / 8,
      ]);
    } else {
      const { center, clockwise } = segment;
      const start = Math.atan2(from[1] - center[1], from[0] - center[0]);
      const angle = start + arcSweep(from, to, center, clockwise) / 2;
      const radius = distance(center, from);
      points.push([center[0] + radius * Math.cos(angle), center[1] + radius * Math.sin(angle)]);
    }
    from = to;
  }
  if (path.closed && path.segments.length > 0 && !pointsCoincide(from, path.start)) {
    points.push(middle(from, path.start));
  }
  return points;
}

function middle(a: Point, b: Point): Point {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}
