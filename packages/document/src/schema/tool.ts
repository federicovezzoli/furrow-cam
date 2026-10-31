import { z } from "zod";
import { FeedRate, Name, PositiveLength, SpindleRpm } from "./units";

export const ToolType = z.enum([
  "flat_end_mill",
  "ball_end_mill",
  "tapered_ball_end_mill",
  "v_bit",
  "drill",
]);
export type ToolType = z.infer<typeof ToolType>;

export const CutDirection = z.enum(["upcut", "downcut", "compression"]);
export type CutDirection = z.infer<typeof CutDirection>;

/** `#rrggbb` in lowercase, as an `<input type="color">` produces. */
export const HexColor = z.string().regex(/^#[0-9a-f]{6}$/, "validation.colour");
export type HexColor = z.infer<typeof HexColor>;

const EndMillType = ToolType.extract(["flat_end_mill", "ball_end_mill", "tapered_ball_end_mill"]);

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
    /**
     * V-bits: flat at the tip, 0 for a sharp point. Tapered ball end mills:
     * the ball at the tip, more than 0.
     */
    tipDiameter: z.number().nonnegative().nullable(),
    /**
     * Tapered ball end mills only (#425): angle of the cone per side in
     * degrees, as the bits are sold. Missing in documents and libraries
     * saved before tapered bits, hence the default.
     */
    taperAngle: z.number().gt(0).lt(90).nullable().default(null),
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
    const isVBit = tool.type === "v_bit";
    const isTapered = tool.type === "tapered_ball_end_mill";
    if (isVBit && tool.vAngle === null) {
      ctx.addIssue({ code: "custom", path: ["vAngle"], message: "tool.vBitRequired" });
    }
    if (!isVBit && tool.vAngle !== null) {
      ctx.addIssue({ code: "custom", path: ["vAngle"], message: "tool.vBitOnly" });
    }
    if (isTapered && tool.taperAngle === null) {
      ctx.addIssue({ code: "custom", path: ["taperAngle"], message: "tool.taperedRequired" });
    }
    if (!isTapered && tool.taperAngle !== null) {
      ctx.addIssue({ code: "custom", path: ["taperAngle"], message: "tool.taperedOnly" });
    }
    if ((isVBit || isTapered) && tool.tipDiameter === null) {
      ctx.addIssue({
        code: "custom",
        path: ["tipDiameter"],
        message: isVBit ? "tool.vBitRequired" : "tool.taperedRequired",
      });
    }
    if (!isVBit && !isTapered && tool.tipDiameter !== null) {
      ctx.addIssue({ code: "custom", path: ["tipDiameter"], message: "tool.tipDiameterOnly" });
    }
    // A ball tip of no size would be a pointed cone, which the profile can't describe.
    if (isTapered && tool.tipDiameter === 0) {
      ctx.addIssue({
        code: "too_small",
        origin: "number",
        minimum: 0,
        inclusive: false,
        input: tool.tipDiameter,
        path: ["tipDiameter"],
      });
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
