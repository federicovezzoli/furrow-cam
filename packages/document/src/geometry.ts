import { z } from "zod";
import { PositiveLength } from "./units";

/**
 * Distance in millimetres below which two points are the same. Imported
 * coordinates carry float rounding, so geometry is never compared exactly.
 */
export const GEOMETRY_TOLERANCE = 1e-3;

/** `[x, y]` in millimetres. */
export const Point = z.tuple([z.number(), z.number()]);
export type Point = z.infer<typeof Point>;

export function distance(a: Point, b: Point): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

/** Whether two points are within `GEOMETRY_TOLERANCE` of each other. */
export function pointsCoincide(a: Point, b: Point): boolean {
  return distance(a, b) <= GEOMETRY_TOLERANCE;
}

export const LineSegment = z.strictObject({
  kind: z.literal("line"),
  to: Point,
});
export type LineSegment = z.infer<typeof LineSegment>;

/**
 * Circular arc from the current point to `to` around `center`. When `to`
 * coincides with the current point (see `pointsCoincide`) the arc is a full
 * circle.
 */
export const ArcSegment = z.strictObject({
  kind: z.literal("arc"),
  to: Point,
  center: Point,
  clockwise: z.boolean(),
});
export type ArcSegment = z.infer<typeof ArcSegment>;

/** Cubic Bézier from the current point to `to`. */
export const CubicSegment = z.strictObject({
  kind: z.literal("cubic"),
  c1: Point,
  c2: Point,
  to: Point,
});
export type CubicSegment = z.infer<typeof CubicSegment>;

/**
 * SVG elliptical arcs and quadratic Béziers are converted to cubics on import,
 * so these three kinds are enough. The original curves are kept so they can be
 * re-flattened at a different tolerance (ADR-0007).
 */
export const Segment = z.discriminatedUnion("kind", [LineSegment, ArcSegment, CubicSegment]);
export type Segment = z.infer<typeof Segment>;

/**
 * What is wrong with `segment` drawn from `current`, or `null`: a line or
 * curve of no length, an arc of no radius, or an arc ending off its circle.
 * Scaling a drawing down can make segments degenerate (ADR-0055).
 */
export function segmentIssue(
  current: Point,
  segment: Segment,
):
  | "geometry.zeroLine"
  | "geometry.zeroCurve"
  | "geometry.zeroArc"
  | "geometry.arcEndOffCircle"
  | null {
  if (segment.kind === "line")
    return pointsCoincide(current, segment.to) ? "geometry.zeroLine" : null;
  if (segment.kind === "cubic") {
    const points = [segment.c1, segment.c2, segment.to];
    return points.every((p) => pointsCoincide(current, p)) ? "geometry.zeroCurve" : null;
  }
  const radius = distance(segment.center, current);
  if (radius <= GEOMETRY_TOLERANCE) return "geometry.zeroArc";
  if (Math.abs(distance(segment.center, segment.to) - radius) > GEOMETRY_TOLERANCE) {
    return "geometry.arcEndOffCircle";
  }
  return null;
}

/**
 * A path with no segments is a single point (e.g. a drill location). A closed
 * path ends with an implicit line back to `start` if it isn't already there.
 */
export const Path = z
  .strictObject({
    start: Point,
    segments: z.array(Segment),
    closed: z.boolean(),
  })
  .superRefine((path, ctx) => {
    let current = path.start;
    path.segments.forEach((segment, i) => {
      const issue = segmentIssue(current, segment);
      if (issue === "geometry.arcEndOffCircle") {
        ctx.addIssue({ code: "custom", path: ["segments", i, "to"], message: issue });
      } else if (issue !== null) {
        ctx.addIssue({ code: "custom", path: ["segments", i], message: issue });
      }
      current = segment.to;
    });

    const [only] = path.segments;
    if (path.closed && (!only || (path.segments.length === 1 && only.kind === "line"))) {
      ctx.addIssue({
        code: "custom",
        path: ["closed"],
        message: "geometry.closedSingleLine",
      });
    }
  });
export type Path = z.infer<typeof Path>;

export const TextAlign = z.enum(["left", "center", "right"]);
export type TextAlign = z.infer<typeof TextAlign>;

/**
 * Where a text item sits (ADR-0059): its origin, the point on its first
 * line's baseline at the alignment, lands at `position` in stock
 * coordinates. The text is mirrored left to right first if `mirrored`, then
 * turned `rotation` degrees counter-clockwise about its origin.
 */
export const TextPlacement = z.strictObject({
  position: Point,
  /** Degrees, from 0 up to 360. */
  rotation: z.number().min(0).lt(360),
  mirrored: z.boolean(),
});
export type TextPlacement = z.infer<typeof TextPlacement>;

/** A text item's settings (PRD-0010 T1, T3), from which its outlines are laid out. */
export const TextSettings = z.strictObject({
  text: z.string().regex(/\S/, "validation.blank"),
  /** The font's id. */
  font: z.string().min(1),
  /** Cap height, in millimetres. */
  height: PositiveLength,
  align: TextAlign,
  placement: TextPlacement,
});
export type TextSettings = z.infer<typeof TextSettings>;

/**
 * The shapes of one imported SVG or DXF file (ADR-0055), which are sized and
 * placed together, or a text item (ADR-0059). Its shapes name it with
 * `drawingId`.
 */
export const Drawing = z.strictObject({
  id: z.uuid(),
  /** Name of the imported file, or the text item's. */
  name: z.string(),
  /** The border, in millimetres, that *Fit to stock* leaves around it, as a model's (ADR-0038). */
  border: z.number().nonnegative(),
  /** A text item's settings; its outlines are its one shape, laid out from them (ADR-0059). */
  text: TextSettings.optional(),
});
export type Drawing = z.infer<typeof Drawing>;

/** The border a new drawing leaves around it when fitted to the stock, in millimetres. */
export const DRAWING_BORDER = 10;

/**
 * Imported geometry, in stock coordinates (ADR-0014): `(0, 0)` is the stock's
 * bottom-left corner whatever the work origin. `stockOffset` in
 * `@furrow/cam-core` converts to work coordinates. Importing, choosing an XY
 * anchor and resizing the stock align the drawing to the stock at the anchor
 * (ADR-0022).
 */
export const Shape = z.strictObject({
  id: z.uuid(),
  /** May be empty: imported entities often have no name. */
  name: z.string(),
  layer: z.string(),
  /** Name of the imported file. */
  source: z.string().optional(),
  /** The drawing it belongs to (ADR-0055). */
  drawingId: z.uuid(),
  paths: z.array(Path).min(1),
});
export type Shape = z.infer<typeof Shape>;
