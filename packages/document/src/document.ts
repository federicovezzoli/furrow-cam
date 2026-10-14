import { z } from "zod";
import { Shape } from "./geometry";
import { Machine } from "./machine";
import { Operation } from "./operation";
import { PositiveLength, Units } from "./units";

export const CURRENT_SCHEMA_VERSION = 6;

/** The 9 stock points an XY zero can sit on: corners, edge midpoints and the centre. */
export const StockAnchor = z.enum([
  "bottom_left",
  "bottom_center",
  "bottom_right",
  "middle_left",
  "center",
  "middle_right",
  "top_left",
  "top_center",
  "top_right",
]);
export type StockAnchor = z.infer<typeof StockAnchor>;

/**
 * Where the machine's XY zero is (ADR-0016): a stock anchor, which follows the
 * stock when it is resized, or a custom point in millimetres from the stock's
 * bottom-left corner, which keeps its stock position and may lie outside the
 * stock (a fixture corner, a fence).
 *
 * Documents saved before custom zeros stored a bare anchor name
 * (`"bottom_left"` or `"center"`); parsing still accepts those and normalises
 * them to `{ anchor }`.
 */
export const XYOrigin = z.preprocess(
  // Normalised before the union, so invalid origins still report the exact field.
  (value) => (value === "bottom_left" || value === "center" ? { anchor: value } : value),
  z.discriminatedUnion("anchor", [
    z.strictObject({ anchor: StockAnchor }),
    z.strictObject({ anchor: z.literal("custom"), x: z.number(), y: z.number() }),
  ]),
);
export type XYOrigin = z.infer<typeof XYOrigin>;

export const ZOrigin = z.enum(["stock_top", "machine_bed"]);
export type ZOrigin = z.infer<typeof ZOrigin>;

export const Stock = z.strictObject({
  width: PositiveLength,
  height: PositiveLength,
  thickness: PositiveLength,
  xyOrigin: XYOrigin,
  zOrigin: ZOrigin,
});
export type Stock = z.infer<typeof Stock>;

/**
 * The contents of a project: stored in `Project.document` and used as the
 * export/import file format (ADR-0003). Read stored or imported documents
 * with `parseProjectDocument`, which upgrades older versions first.
 *
 * Objects owned by the document are strict: unknown keys are errors rather
 * than silently dropped, so a misspelt field or an unversioned change fails
 * loudly instead of losing data on the next save.
 */
export const ProjectDocument = z
  .strictObject({
    schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
    units: Units,
    stock: Stock,
    /** Snapshot of the machine profile, or `null` if none is picked. */
    machine: Machine.nullable(),
    geometry: z.array(Shape),
    /** In cutting order. */
    operations: z.array(Operation),
  })
  .superRefine((doc, ctx) => {
    /** Each shape's number of paths, by id. */
    const pathCounts = new Map<string, number>();
    doc.geometry.forEach((shape, i) => {
      if (pathCounts.has(shape.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["geometry", i, "id"],
          message: "Duplicate shape id",
        });
      }
      pathCounts.set(shape.id, shape.paths.length);
    });

    const operationIds = new Set<string>();
    doc.operations.forEach((operation, i) => {
      if (operationIds.has(operation.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["operations", i, "id"],
          message: "Duplicate operation id",
        });
      }
      operationIds.add(operation.id);
      const seen = new Set<string>();
      operation.targets.forEach(({ shapeId, paths }, j) => {
        if (seen.has(shapeId)) {
          ctx.addIssue({
            code: "custom",
            path: ["operations", i, "targets", j, "shapeId"],
            message: "Duplicate shape id",
          });
        }
        seen.add(shapeId);
        const count = pathCounts.get(shapeId);
        if (count === undefined) {
          ctx.addIssue({
            code: "custom",
            path: ["operations", i, "targets", j, "shapeId"],
            message: "Unknown shape id",
          });
          return;
        }
        paths?.forEach((path, k) => {
          if (path >= count) {
            ctx.addIssue({
              code: "custom",
              path: ["operations", i, "targets", j, "paths", k],
              message: "Unknown path",
            });
          }
        });
      });
    });
  });
export type ProjectDocument = z.infer<typeof ProjectDocument>;

/** A new, empty project: 600 × 400 × 18 mm stock, origin at the bottom-left corner of the stock top. */
export function createProjectDocument(): ProjectDocument {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    units: "mm",
    stock: {
      width: 600,
      height: 400,
      thickness: 18,
      xyOrigin: { anchor: "bottom_left" },
      zOrigin: "stock_top",
    },
    machine: null,
    geometry: [],
    operations: [],
  };
}
