import { z } from "zod";
import { Tool } from "./tool";

export const OperationType = z.enum(["profile", "pocket", "drill"]);
export type OperationType = z.infer<typeof OperationType>;

const operationFields = {
  id: z.uuid(),
  name: z.string(),
  enabled: z.boolean(),
  /** Ids of the shapes this operation cuts. */
  shapeIds: z.array(z.uuid()),
  /** Snapshot of the tool at the time it was picked (ADR-0003). */
  tool: Tool,
};

// Type-specific params are added by the CAM issues (#21, #23, #24).
export const ProfileOperation = z.object({
  ...operationFields,
  type: z.literal("profile"),
  params: z.strictObject({}),
});
export type ProfileOperation = z.infer<typeof ProfileOperation>;

export const PocketOperation = z.object({
  ...operationFields,
  type: z.literal("pocket"),
  params: z.strictObject({}),
});
export type PocketOperation = z.infer<typeof PocketOperation>;

export const DrillOperation = z.object({
  ...operationFields,
  type: z.literal("drill"),
  params: z.strictObject({}),
});
export type DrillOperation = z.infer<typeof DrillOperation>;

export const Operation = z.discriminatedUnion("type", [
  ProfileOperation,
  PocketOperation,
  DrillOperation,
]);
export type Operation = z.infer<typeof Operation>;
