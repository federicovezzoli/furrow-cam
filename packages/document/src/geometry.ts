import { z } from "zod";

/** `[x, y]` in millimetres. */
export const Point = z.tuple([z.number(), z.number()]);
export type Point = z.infer<typeof Point>;

export const LineSegment = z.object({
  kind: z.literal("line"),
  to: Point,
});
export type LineSegment = z.infer<typeof LineSegment>;

/**
 * Circular arc from the current point to `to` around `center`. When `to`
 * equals the current point the arc is a full circle.
 */
export const ArcSegment = z.object({
  kind: z.literal("arc"),
  to: Point,
  center: Point,
  clockwise: z.boolean(),
});
export type ArcSegment = z.infer<typeof ArcSegment>;

/** Cubic Bézier from the current point to `to`. */
export const CubicSegment = z.object({
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

/** A path with no segments is a single point (e.g. a drill location). */
export const Path = z
  .object({
    start: Point,
    segments: z.array(Segment),
    closed: z.boolean(),
  })
  .refine((path) => !path.closed || path.segments.length > 0, {
    path: ["closed"],
    message: "A closed path needs at least one segment",
  });
export type Path = z.infer<typeof Path>;

export const Shape = z.object({
  id: z.uuid(),
  name: z.string(),
  layer: z.string(),
  /** Name of the imported file. */
  source: z.string().optional(),
  paths: z.array(Path).min(1),
});
export type Shape = z.infer<typeof Shape>;
