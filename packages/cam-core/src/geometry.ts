import type { Point } from "@furrow/document";
import {
  booleanOpWithPolyTree,
  FillRule as ClipperFillRule,
  ClipType,
  difference as clipDifference,
  intersect as clipIntersect,
  pointInPolygon as clipPointInPolygon,
  union as clipUnion,
  EndType,
  inflatePaths,
  JoinType,
  type Path64,
  type Paths64,
  PointInPolygonResult,
  type PolyPath64,
  PolyTree64,
} from "clipper2-ts";
import { DEFAULT_CHORD_TOLERANCE } from "./flatten";

// Geometry kernel adapter (ADR-0007, ADR-0015). The rest of the CAM core uses
// these functions and types only and never imports Clipper2 directly.

/**
 * A closed ring of points in millimetres. The closing edge is implied, so the
 * last point may repeat the first or not. Outer boundaries wind
 * counter-clockwise and holes clockwise (y up), as in every result here.
 */
export type Polygon = Point[];

/** An outer boundary with the holes directly inside it. */
export type PolygonWithHoles = { outer: Polygon; holes: Polygon[] };

/**
 * Which areas count as inside when rings overlap. With `nonZero`, a ring wound
 * like the ring around it adds to it, so a hole must wind the other way; with
 * `evenOdd`, every nested ring toggles inside and outside whatever its
 * winding, as imported drawings expect (see `nest`).
 */
export type FillRule = "nonZero" | "evenOdd";

/** How an offset turns convex corners. */
export type Join = "round" | "miter" | "square";

export type OffsetOptions = {
  join?: Join;
  /** How the input rings combine before offsetting. */
  fillRule?: FillRule;
  /** Largest distance in millimetres between a round join and its true arc. */
  arcTolerance?: number;
};

export type Containment = "inside" | "outside" | "on";

/** Clipper2 integer units per millimetre: one unit is 0.0001 mm. */
export const CLIPPER_SCALE = 1e4;

/** Miter joins longer than this many times the offset distance are squared off. */
const MITER_LIMIT = 2;

/** Clipper2 returns its input untouched for offsets below half a unit. */
const MIN_DELTA = 0.5 / CLIPPER_SCALE;

const FILL_RULES: Record<FillRule, ClipperFillRule> = {
  nonZero: ClipperFillRule.NonZero,
  evenOdd: ClipperFillRule.EvenOdd,
};

const JOINS: Record<Join, JoinType> = {
  round: JoinType.Round,
  miter: JoinType.Miter,
  square: JoinType.Square,
};

/**
 * Grows (positive `delta`) or shrinks (negative) the area covered by
 * `polygons` by `delta` millimetres; holes move the other way. Shapes that
 * shrink to nothing vanish, and shapes that pinch split. The input is first
 * resolved with `fillRule` (default `nonZero`), so any winding is accepted and
 * a zero offset returns the cleaned area.
 *
 * For successive rings (pockets), offset the original polygons by a growing
 * delta rather than offsetting each ring again: every pass adds join vertices,
 * so chained offsets grow the point count without bound.
 */
export function offset(polygons: Polygon[], delta: number, options: OffsetOptions = {}): Polygon[] {
  const arcTolerance = options.arcTolerance ?? DEFAULT_CHORD_TOLERANCE;
  if (!(arcTolerance > 0)) throw new RangeError("Arc tolerance must be positive");
  if (!Number.isFinite(delta)) throw new RangeError("Offset distance must be finite");
  // Offsetting keeps the winding of its input and fills with the Positive rule,
  // so it gets clean rings: outer boundaries counter-clockwise, holes clockwise.
  const area = clipUnion(toPaths(polygons), FILL_RULES[options.fillRule ?? "nonZero"]);
  if (Math.abs(delta) < MIN_DELTA) return fromPaths(area);
  const result = inflatePaths(
    area,
    delta * CLIPPER_SCALE,
    JOINS[options.join ?? "round"],
    EndType.Polygon,
    MITER_LIMIT,
    arcTolerance * CLIPPER_SCALE,
  );
  return fromPaths(result);
}

/** The area covered by any of `polygons`. */
export function union(polygons: Polygon[], fillRule: FillRule = "nonZero"): Polygon[] {
  return fromPaths(clipUnion(toPaths(polygons), FILL_RULES[fillRule]));
}

/** The area covered by `subject` but not by `clip`. */
export function difference(
  subject: Polygon[],
  clip: Polygon[],
  fillRule: FillRule = "nonZero",
): Polygon[] {
  return fromPaths(clipDifference(toPaths(subject), toPaths(clip), FILL_RULES[fillRule]));
}

/** The area covered by both `subject` and `clip`. */
export function intersection(
  subject: Polygon[],
  clip: Polygon[],
  fillRule: FillRule = "nonZero",
): Polygon[] {
  return fromPaths(clipIntersect(toPaths(subject), toPaths(clip), FILL_RULES[fillRule]));
}

/**
 * Groups rings into outer boundaries and their holes. With the default
 * even-odd rule, nesting alone decides: a ring inside one outer boundary is a
 * hole, a ring inside that hole is a new outer boundary (an island), and
 * winding direction does not matter, as with imported drawings.
 */
export function nest(polygons: Polygon[], fillRule: FillRule = "evenOdd"): PolygonWithHoles[] {
  const tree = new PolyTree64();
  booleanOpWithPolyTree(ClipType.Union, toPaths(polygons), null, tree, FILL_RULES[fillRule]);
  const result: PolygonWithHoles[] = [];
  const visit = (outer: PolyPath64) => {
    const holes: Polygon[] = [];
    for (let i = 0; i < outer.count; i++) {
      const hole = outer.child(i);
      holes.push(fromPath(hole.polygon ?? []));
      for (let j = 0; j < hole.count; j++) visit(hole.child(j));
    }
    result.push({ outer: fromPath(outer.polygon ?? []), holes });
  };
  for (let i = 0; i < tree.count; i++) visit(tree.child(i));
  return result;
}

/**
 * Where `point` lies relative to `polygon`. Both are rounded to whole Clipper2
 * units (0.0001 mm) first, so "on" means within about half a unit of the
 * rounded ring.
 */
export function containment(point: Point, polygon: Polygon): Containment {
  const result = clipPointInPolygon(toPoint(point), toPath(polygon));
  if (result === PointInPolygonResult.IsInside) return "inside";
  if (result === PointInPolygonResult.IsOutside) return "outside";
  return "on";
}

/** Signed area in mm²: positive for counter-clockwise rings (y up). */
export function signedArea(polygon: Polygon): number {
  let twice = 0;
  let previous = polygon.at(-1);
  for (const point of polygon) {
    if (previous) twice += previous[0] * point[1] - point[0] * previous[1];
    previous = point;
  }
  return twice / 2;
}

function toPoint([x, y]: Point) {
  return { x: Math.round(x * CLIPPER_SCALE), y: Math.round(y * CLIPPER_SCALE) };
}

function toPath(polygon: Polygon): Path64 {
  return polygon.map(toPoint);
}

function toPaths(polygons: Polygon[]): Paths64 {
  return polygons.map(toPath);
}

function fromPath(path: Path64): Polygon {
  return path.map(({ x, y }) => [x / CLIPPER_SCALE, y / CLIPPER_SCALE]);
}

function fromPaths(paths: Paths64): Polygon[] {
  return paths.map(fromPath);
}
