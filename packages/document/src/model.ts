import { z } from "zod";

/** A SHA-256 digest as 64 lowercase hex digits. */
export const Sha256 = z.string().regex(/^[0-9a-f]{64}$/, "Must be a SHA-256 hash in lowercase hex");
export type Sha256 = z.infer<typeof Sha256>;

/** A point in 3D, `[x, y, z]`. */
export const Point3 = z.tuple([z.number(), z.number(), z.number()]);
export type Point3 = z.infer<typeof Point3>;

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
});
export type Model = z.infer<typeof Model>;
