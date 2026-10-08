import { z } from "zod";
import { Shape } from "./geometry";
import { Machine } from "./machine";
import { Operation } from "./operation";
import { PositiveLength, Units } from "./units";

export const CURRENT_SCHEMA_VERSION = 1;

export const XYOrigin = z.enum(["bottom_left", "center"]);
export type XYOrigin = z.infer<typeof XYOrigin>;

export const ZOrigin = z.enum(["stock_top", "machine_bed"]);
export type ZOrigin = z.infer<typeof ZOrigin>;

export const Stock = z.object({
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
 */
export const ProjectDocument = z
  .object({
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
    const shapeIds = new Set<string>();
    doc.geometry.forEach((shape, i) => {
      if (shapeIds.has(shape.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["geometry", i, "id"],
          message: "Duplicate shape id",
        });
      }
      shapeIds.add(shape.id);
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
      operation.shapeIds.forEach((shapeId, j) => {
        if (!shapeIds.has(shapeId)) {
          ctx.addIssue({
            code: "custom",
            path: ["operations", i, "shapeIds", j],
            message: "Unknown shape id",
          });
        }
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
      xyOrigin: "bottom_left",
      zOrigin: "stock_top",
    },
    machine: null,
    geometry: [],
    operations: [],
  };
}
