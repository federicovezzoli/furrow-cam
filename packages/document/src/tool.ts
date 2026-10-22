import { z } from "zod";
import { FeedRate, Name, PositiveLength, SpindleRpm } from "./units";

export const ToolType = z.enum(["flat_end_mill", "ball_end_mill", "v_bit", "drill"]);
export type ToolType = z.infer<typeof ToolType>;

export const CutDirection = z.enum(["upcut", "downcut", "compression"]);
export type CutDirection = z.infer<typeof CutDirection>;

/** `#rrggbb` in lowercase, as an `<input type="color">` produces. */
export const HexColor = z.string().regex(/^#[0-9a-f]{6}$/, "validation.colour");
export type HexColor = z.infer<typeof HexColor>;

const EndMillType = ToolType.extract(["flat_end_mill", "ball_end_mill"]);

/**
 * A router bit (#10). Used to validate the user's tool library and stored as a
 * snapshot in each operation, so editing the library never changes existing
 * projects (ADR-0003). Type-specific fields are `null` when they don't apply,
 * mirroring nullable database columns. Unknown keys are stripped, so a
 * database row can be snapshotted with `Tool.parse(row)`.
 */
export const Tool = z
  .object({
    name: Name,
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
    /**
     * Steepest angle in degrees, from horizontal, at which the bit may enter
     * the material, at least 1° (shallower ramps get impractically long).
     * `90` plunges straight down; drills are always `90`.
     */
    plungeAngle: z.number().min(1).max(90),
    /** Depth per pass. */
    stepDown: PositiveLength,
    notes: z.string().nullable(),
    /** Identifies the tool in the library and colours its toolpaths in the preview. */
    color: HexColor,
  })
  .superRefine((tool, ctx) => {
    const isEndMill = EndMillType.safeParse(tool.type).success;
    if (isEndMill && tool.cutDirection === null) {
      ctx.addIssue({
        code: "custom",
        path: ["cutDirection"],
        message: "tool.cutDirectionRequired",
      });
    }
    if (!isEndMill && tool.cutDirection !== null) {
      ctx.addIssue({
        code: "custom",
        path: ["cutDirection"],
        message: "tool.cutDirectionEndMillsOnly",
      });
    }
    for (const key of ["vAngle", "tipDiameter"] as const) {
      if (tool.type === "v_bit" && tool[key] === null) {
        ctx.addIssue({ code: "custom", path: [key], message: "tool.vBitRequired" });
      }
      if (tool.type !== "v_bit" && tool[key] !== null) {
        ctx.addIssue({ code: "custom", path: [key], message: "tool.vBitOnly" });
      }
    }
    if (tool.type === "drill" && tool.plungeAngle !== 90) {
      ctx.addIssue({ code: "custom", path: ["plungeAngle"], message: "tool.drillPlunge90" });
    }
    if (tool.stepDown > tool.fluteLength) {
      ctx.addIssue({
        code: "custom",
        path: ["stepDown"],
        message: "tool.exceedsFluteLength",
      });
    }
    if (tool.tipDiameter !== null && tool.tipDiameter >= tool.diameter) {
      ctx.addIssue({
        code: "custom",
        path: ["tipDiameter"],
        message: "tool.smallerThanDiameter",
      });
    }
  });
export type Tool = z.infer<typeof Tool>;
