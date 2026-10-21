import { z } from "zod";

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
      if (segment.kind === "line" && pointsCoincide(current, segment.to)) {
        ctx.addIssue({ code: "custom", path: ["segments", i], message: "geometry.zeroLine" });
      }
      if (
        segment.kind === "cubic" &&
        [segment.c1, segment.c2, segment.to].every((p) => pointsCoincide(current, p))
      ) {
        ctx.addIssue({ code: "custom", path: ["segments", i], message: "geometry.zeroCurve" });
      }
      if (segment.kind === "arc") {
        const radius = distance(segment.center, current);
        if (radius <= GEOMETRY_TOLERANCE) {
          ctx.addIssue({ code: "custom", path: ["segments", i], message: "geometry.zeroArc" });
        } else if (Math.abs(distance(segment.center, segment.to) - radius) > GEOMETRY_TOLERANCE) {
          ctx.addIssue({
            code: "custom",
            path: ["segments", i, "to"],
            message: "geometry.arcEndOffCircle",
          });
        }
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

/**
 * The shapes of one imported SVG or DXF file (ADR-0055), which are sized and
 * placed together. Its shapes name it with `drawingId`.
 */
export const Drawing = z.strictObject({
  id: z.uuid(),
  /** Name of the imported file. */
  name: z.string(),
  /** The border, in millimetres, that *Fit to stock* leaves around it, as a model's (ADR-0038). */
  border: z.number().nonnegative(),
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
