import { z } from "zod";
import { FeedRate, Name, PositiveLength, SpindleRpm } from "./units";

export const PostProcessorId = z.enum(["grbl"]);
export type PostProcessorId = z.infer<typeof PostProcessorId>;

/**
 * Custom G-code written verbatim at one point of the program, replacing what
 * the post-processor writes there by default. `null` keeps the default. A
 * machine's blocks have no placeholders: the text is copied as is.
 */
export const GcodeBlock = z
  .string()
  .regex(/\S/, "Must not be blank")
  .max(10_000, "Must be at most 10,000 characters")
  .nullable();

/** Entry clearance of new machines, and of toolpaths without a machine profile. */
export const DEFAULT_ENTRY_CLEARANCE = 1;

/**
 * Starting values of every new machine, from scratch or from a preset: Furrow
 * CAM's own defaults rather than facts about a machine.
 */
export const NEW_MACHINE_DEFAULTS = {
  safeZ: 5,
  entryClearance: DEFAULT_ENTRY_CLEARANCE,
  postProcessor: "grbl",
} as const satisfies Partial<Machine>;

/**
 * A machine profile (#11). Used to validate the user's machines and stored as
 * a snapshot in each project (ADR-0003). Strict like the rest of the document:
 * read a database row with `machineFields` first.
 */
export const Machine = z
  .strictObject({
    name: Name,
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
    /** Height above the stock top where rapids down stop and feeding starts, at most `safeZ`. */
    entryClearance: z.number().nonnegative(),
    postProcessor: PostProcessorId,
    /** Replaces the default preamble (units, absolute mode, feed mode…). */
    programStart: GcodeBlock,
    /** Replaces the default ending (spindle off, retract, program end). */
    programEnd: GcodeBlock,
    /** Written before each operation, in place of the default comment. */
    operationStart: GcodeBlock,
    /** Replaces the default tool change (spindle off and a pause). */
    toolChange: GcodeBlock,
  })
  .superRefine((machine, ctx) => {
    if (machine.safeZ >= machine.workAreaZ) {
      ctx.addIssue({
        code: "custom",
        path: ["safeZ"],
        message: "Must be less than the Z travel",
      });
    }
    if (machine.entryClearance > machine.safeZ) {
      ctx.addIssue({
        code: "custom",
        path: ["entryClearance"],
        message: "Must be at most the safe Z",
      });
    }
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

const MACHINE_FIELDS = Object.keys(Machine.shape) as (keyof Machine)[];

/**
 * Copies the profile fields out of a database row, dropping columns such as
 * `id` and `userId`. Doesn't validate, so a row that fails rules added since
 * it was saved can still be shown in the form and fixed.
 */
export function machineFields(row: Machine): Machine {
  return Object.fromEntries(MACHINE_FIELDS.map((key) => [key, row[key]])) as Machine;
}
