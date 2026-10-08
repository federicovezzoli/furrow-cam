import { z } from "zod";

export const CURRENT_SCHEMA_VERSION = 1;

export const Units = z.enum(["mm", "in"]);
export type Units = z.infer<typeof Units>;

export const Stock = z.object({
  width: z.number().positive(),
  height: z.number().positive(),
  thickness: z.number().positive(),
});
export type Stock = z.infer<typeof Stock>;

export const ProjectDocument = z.object({
  schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
  units: Units,
  stock: Stock,
});
export type ProjectDocument = z.infer<typeof ProjectDocument>;
