import { z } from "zod";
import { Point } from "./geometry";
import { Tool } from "./tool";
import { Name, PositiveLength } from "./units";

export const OperationType = z.enum(["profile", "pocket", "drill"]);
export type OperationType = z.infer<typeof OperationType>;

/**
 * Some or all of a shape's paths (ADR-0018). Shapes aren't edited after
 * import, so path indices are stable.
 */
export const OperationTarget = z.strictObject({
  shapeId: z.uuid(),
  /** Indices into the shape's `paths`, ascending, or `null` for all of them. */
  paths: z
    .array(z.int().nonnegative())
    .min(1)
    .refine((paths) => paths.every((path, i) => i === 0 || path > (paths[i - 1] as number)), {
      message: "Path indices must be ascending, each once",
    })
    .nullable(),
});
export type OperationTarget = z.infer<typeof OperationTarget>;

const operationFields = {
  id: z.uuid(),
  name: Name,
  enabled: z.boolean(),
  /** What this operation cuts, one target per shape. */
  targets: z.array(OperationTarget),
  /** Snapshot of the tool at the time it was picked (ADR-0003). */
  tool: Tool,
};

/** Which side of the contour the tool cuts on: `on` follows the line itself. */
export const ProfileSide = z.enum(["inside", "outside", "on"]);
export type ProfileSide = z.infer<typeof ProfileSide>;

/** Milling direction, for a spindle turning clockwise seen from above. */
export const MillingDirection = z.enum(["climb", "conventional"]);
export type MillingDirection = z.infer<typeof MillingDirection>;

/**
 * Holding tabs (#22): bridges of material the profile leaves so the part stays
 * attached to the stock. Rectangular: over a tab the tool rises straight to
 * `height` above the final depth, crosses it flat and goes straight back down,
 * on the passes that would otherwise cut lower.
 */
export const ProfileTabs = z.strictObject({
  /** Length of the material left along the contour. */
  width: PositiveLength,
  /** Height of the material left, up from the profile's final depth. */
  height: PositiveLength,
  /** Where the tabs are, in stock coordinates; each goes to the nearest closed contour. */
  positions: z.array(Point),
});
export type ProfileTabs = z.infer<typeof ProfileTabs>;

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
    /** Holding tabs, or `null` to cut the closed contours all the way round. */
    tabs: ProfileTabs.nullable(),
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

export const ProfileOperation = z.strictObject({
  ...operationFields,
  type: z.literal("profile"),
  params: ProfileParams,
});
export type ProfileOperation = z.infer<typeof ProfileOperation>;

/**
 * Pocket parameters (#23): offset clearing of the area inside the closed
 * paths, islands left standing. The step-over, step-down and ramp angle come
 * from the tool.
 */
export const PocketParams = z
  .strictObject({
    direction: MillingDirection,
    /** Final depth below the stock top. */
    depth: PositiveLength,
    /** Material the clearing passes leave on the walls and islands. */
    allowance: z.number().nonnegative(),
    /** One more lap at full depth on each exact wall, removing the allowance. */
    finishPass: z.boolean(),
    /** Ramp in at the tool's plunge angle instead of plunging straight down. */
    ramp: z.boolean(),
  })
  .superRefine((params, ctx) => {
    if (params.finishPass && params.allowance === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["finishPass"],
        message: "Needs an allowance to remove",
      });
    }
  });
export type PocketParams = z.infer<typeof PocketParams>;

export const PocketOperation = z.strictObject({
  ...operationFields,
  type: z.literal("pocket"),
  params: PocketParams,
});
export type PocketOperation = z.infer<typeof PocketOperation>;

/**
 * Drill parameters (#24): holes at points and at circles of the tool's
 * diameter. The peck depth comes from the tool's step-down.
 */
export const DrillParams = z.strictObject({
  /** Depth of the tool tip below the stock top. */
  depth: PositiveLength,
  /** Drill in pecks, retracting above the stock after each to clear chips. */
  peck: z.boolean(),
});
export type DrillParams = z.infer<typeof DrillParams>;

/** Drills and end mills can drill: a V-bit's diameter doesn't describe the hole it makes. */
export function canDrill(tool: Tool): boolean {
  return tool.type !== "v_bit";
}

export const DrillOperation = z
  .strictObject({
    ...operationFields,
    type: z.literal("drill"),
    params: DrillParams,
  })
  .superRefine((operation, ctx) => {
    if (!canDrill(operation.tool)) {
      ctx.addIssue({ code: "custom", path: ["tool", "type"], message: "V-bits can't drill" });
    }
  });
export type DrillOperation = z.infer<typeof DrillOperation>;

export const Operation = z.discriminatedUnion("type", [
  ProfileOperation,
  PocketOperation,
  DrillOperation,
]);
export type Operation = z.infer<typeof Operation>;
