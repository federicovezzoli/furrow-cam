import { z } from "zod";
import { Point } from "./geometry";
import { PositiveLength } from "./units";

/** A SHA-256 digest as 64 lowercase hex digits. */
export const Sha256 = z.string().regex(/^[0-9a-f]{64}$/, "Must be a SHA-256 hash in lowercase hex");
export type Sha256 = z.infer<typeof Sha256>;

/** A point in 3D, `[x, y, z]`. */
export const Point3 = z.tuple([z.number(), z.number(), z.number()]);
export type Point3 = z.infer<typeof Point3>;

/** A rotation in quarter turns, in degrees. */
export const QuarterTurn = z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]);
export type QuarterTurn = z.infer<typeof QuarterTurn>;

/**
 * Where a model sits in the stock (PRD-0005 S2), in stock coordinates
 * (ADR-0014). The mesh is rotated first, then scaled, then moved so that its
 * top is at the stock top and its bounding box's bottom-left corner at
 * `position`. It is machined from the top only (S3).
 */
export const ModelPlacement = z.strictObject({
  /** Turns about the stock's X, then Y, then Z axis. */
  rotation: z.tuple([QuarterTurn, QuarterTurn, QuarterTurn]),
  /** Scale in X and Y, the same both ways so the model keeps its outline. */
  scale: z.number().positive(),
  /**
   * How far the model reaches into the stock from its top: the rotated
   * mesh's height is scaled to it. Edits keep it at that height times
   * `scale`, so the mesh keeps its proportions (ADR-0034); a model placed
   * before then may still be stretched or squashed by it.
   */
  depth: PositiveLength,
  /** Bottom-left corner of the placed model's bounding box. */
  position: Point,
});
export type ModelPlacement = z.infer<typeof ModelPlacement>;

/**
 * An imported 3D model (PRD-0005). The mesh itself isn't in the document: it
 * is a project asset identified by the SHA-256 of the STL file's bytes
 * (ADR-0029). The rest describes it without downloading it.
 */
export const Model = z.strictObject({
  id: z.uuid(),
  /** Hash of the STL file, the key of its project asset. */
  sha256: Sha256,
  /** Name of the imported file. */
  fileName: z.string(),
  /** Size of the STL file in bytes. */
  size: z.number().int().positive(),
  triangles: z.number().int().positive(),
  /** The mesh's bounding box in the file's own coordinates, before placement. */
  bounds: z
    .strictObject({ min: Point3, max: Point3 })
    .refine(({ min, max }) => min.every((value, i) => value <= (max[i] as number)), {
      message: "The minimum corner must not exceed the maximum",
    }),
  placement: ModelPlacement,
});
export type Model = z.infer<typeof Model>;
