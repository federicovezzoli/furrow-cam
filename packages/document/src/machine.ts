import { z } from "zod";
import { FeedRate, PositiveLength, SpindleRpm } from "./units";

export const PostProcessorId = z.enum(["grbl"]);
export type PostProcessorId = z.infer<typeof PostProcessorId>;

/**
 * A machine profile (#11). Used to validate the user's machines and stored as
 * a snapshot in each project (ADR-0003).
 */
export const Machine = z
  .object({
    name: z.string().trim().min(1),
    workAreaX: PositiveLength,
    workAreaY: PositiveLength,
    workAreaZ: PositiveLength,
    maxFeedXY: FeedRate,
    maxFeedZ: FeedRate,
    /** Both `null` for a manual spindle: the post-processor omits the `S` word. */
    spindleRpmMin: SpindleRpm.nullable(),
    spindleRpmMax: SpindleRpm.nullable(),
    /** Default retract height above the stock. */
    safeZ: PositiveLength,
    postProcessor: PostProcessorId,
  })
  .superRefine((machine, ctx) => {
    const { spindleRpmMin: min, spindleRpmMax: max } = machine;
    if ((min === null) !== (max === null)) {
      ctx.addIssue({
        code: "custom",
        path: [min === null ? "spindleRpmMin" : "spindleRpmMax"],
        message: "Set both spindle speeds, or neither for a manual spindle",
      });
    } else if (min !== null && max !== null && min > max) {
      ctx.addIssue({
        code: "custom",
        path: ["spindleRpmMax"],
        message: "Must be at least the minimum spindle speed",
      });
    }
  });
export type Machine = z.infer<typeof Machine>;
