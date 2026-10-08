import { z } from "zod";
import { FeedRate, PositiveLength, SpindleRpm } from "./units";

export const ToolType = z.enum(["flat_end_mill", "ball_end_mill", "v_bit", "drill"]);
export type ToolType = z.infer<typeof ToolType>;

export const CutDirection = z.enum(["upcut", "downcut", "compression"]);
export type CutDirection = z.infer<typeof CutDirection>;

const END_MILLS: readonly ToolType[] = ["flat_end_mill", "ball_end_mill"];

/**
 * A router bit (#10). Used to validate the user's tool library and stored as a
 * snapshot in each operation, so editing the library never changes existing
 * projects (ADR-0003). Type-specific fields are `null` when they don't apply,
 * mirroring nullable database columns.
 */
export const Tool = z
  .object({
    name: z.string().trim().min(1),
    type: ToolType,
    diameter: PositiveLength,
    fluteCount: z.number().int().positive(),
    fluteLength: PositiveLength,
    /** End mills only. */
    cutDirection: CutDirection.nullable(),
    /** V-bits only: included angle in degrees. */
    vAngle: z.number().gt(0).lt(180).nullable(),
    /** V-bits only: flat at the tip, 0 for a sharp point. */
    tipDiameter: z.number().nonnegative().nullable(),
    spindleRpm: SpindleRpm,
    feedRate: FeedRate,
    plungeRate: FeedRate,
    /** Depth per pass. */
    stepDown: PositiveLength,
    /** Percentage of the diameter. */
    stepOver: z.number().gt(0).max(100),
    notes: z.string().nullable(),
  })
  .superRefine((tool, ctx) => {
    const isEndMill = END_MILLS.includes(tool.type);
    if (isEndMill && tool.cutDirection === null) {
      ctx.addIssue({ code: "custom", path: ["cutDirection"], message: "Required for end mills" });
    }
    if (!isEndMill && tool.cutDirection !== null) {
      ctx.addIssue({ code: "custom", path: ["cutDirection"], message: "Only for end mills" });
    }
    for (const key of ["vAngle", "tipDiameter"] as const) {
      if (tool.type === "v_bit" && tool[key] === null) {
        ctx.addIssue({ code: "custom", path: [key], message: "Required for V-bits" });
      }
      if (tool.type !== "v_bit" && tool[key] !== null) {
        ctx.addIssue({ code: "custom", path: [key], message: "Only for V-bits" });
      }
    }
    if (tool.tipDiameter !== null && tool.tipDiameter >= tool.diameter) {
      ctx.addIssue({
        code: "custom",
        path: ["tipDiameter"],
        message: "Must be smaller than the diameter",
      });
    }
  });
export type Tool = z.infer<typeof Tool>;
