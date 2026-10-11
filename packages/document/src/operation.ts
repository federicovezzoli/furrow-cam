import { z } from "zod";
import { Tool } from "./tool";
import { Name, PositiveLength } from "./units";

export const OperationType = z.enum(["profile", "pocket", "drill"]);
export type OperationType = z.infer<typeof OperationType>;

const operationFields = {
  id: z.uuid(),
  name: Name,
  enabled: z.boolean(),
  /** Ids of the shapes this operation cuts. */
  shapeIds: z.array(z.uuid()),
  /** Snapshot of the tool at the time it was picked (ADR-0003). */
  tool: Tool,
};

/** Which side of the contour the tool cuts on: `on` follows the line itself. */
export const ProfileSide = z.enum(["inside", "outside", "on"]);
export type ProfileSide = z.infer<typeof ProfileSide>;

/** Milling direction, for a spindle turning clockwise seen from above. */
export const MillingDirection = z.enum(["climb", "conventional"]);
export type MillingDirection = z.infer<typeof MillingDirection>;

/** Profile parameters (#21). The step-down and the ramp angle come from the tool. */
export const ProfileParams = z
  .strictObject({
    side: ProfileSide,
    direction: MillingDirection,
    /** Final depth below the stock top. */
    depth: PositiveLength,
    /** Material the depth passes leave on the wall. */
    allowance: z.number().nonnegative(),
    /** One more lap at full depth on the exact contour, removing the allowance. */
    finishPass: z.boolean(),
    /** Tangent arc on the waste side into each closed contour, or `null` to start on it. */
    leadIn: z.strictObject({ radius: PositiveLength }).nullable(),
    /** Ramp in at the tool's plunge angle instead of plunging straight down. */
    ramp: z.boolean(),
  })
  .superRefine((params, ctx) => {
    if (params.side === "on" && params.allowance !== 0) {
      ctx.addIssue({ code: "custom", path: ["allowance"], message: "Must be 0 on the line" });
    }
    if (params.finishPass && params.allowance === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["finishPass"],
        message: "Needs an allowance to remove",
      });
    }
  });
export type ProfileParams = z.infer<typeof ProfileParams>;

// Type-specific params of the other operations are added by #23 and #24.
export const ProfileOperation = z.strictObject({
  ...operationFields,
  type: z.literal("profile"),
  params: ProfileParams,
});
export type ProfileOperation = z.infer<typeof ProfileOperation>;

export const PocketOperation = z.strictObject({
  ...operationFields,
  type: z.literal("pocket"),
  params: z.strictObject({}),
});
export type PocketOperation = z.infer<typeof PocketOperation>;

export const DrillOperation = z.strictObject({
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
