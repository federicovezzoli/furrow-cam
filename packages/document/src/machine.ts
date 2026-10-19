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
 * Spin-up delay of new machines, and of G-code without a machine profile, in
 * seconds: long enough for a trim router and most VFD spindles to reach speed.
 */
export const DEFAULT_SPIN_UP_DELAY = 5;

/**
 * Starting values of every new machine, from scratch or from a preset: Furrow
 * CAM's own defaults rather than facts about a machine.
 */
export const NEW_MACHINE_DEFAULTS = {
  safeZ: 5,
  entryClearance: DEFAULT_ENTRY_CLEARANCE,
  spinUpDelay: DEFAULT_SPIN_UP_DELAY,
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
    /**
     * Seconds the post-processor waits after starting the spindle or raising
     * its speed, before the next move: GRBL doesn't wait for it to spin up.
     * Ignored for a manual spindle, which is switched on by hand and already
     * up to speed when the job starts or resumes.
     */
    spinUpDelay: z.number().nonnegative().max(60, "Must be at most 60 seconds"),
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
 * The dwell after the spindle starts or speeds up, in seconds as G-code
 * writes them (to the millisecond): the machine's spin-up delay, the default
 * without a machine, none for a manual spindle, which is switched on by hand
 * and already up to speed when the job starts or resumes.
 */
export function machineSpinUpDelay(machine: Machine | null): number {
  if (machine !== null && machine.spindleRpmMin === null) return 0;
  return Math.round((machine?.spinUpDelay ?? DEFAULT_SPIN_UP_DELAY) * 1000) / 1000;
}

/**
 * A machine as an earlier release stored it, with the fields added since
 * filled in, for the stores that have no schema version: the desktop app's
 * and the guest workspace's machine lists. Each new field's default goes
 * here as well as in the document migration for its snapshots, which stays
 * as it was written for its version.
 */
export function upgradeMachine(stored: unknown): unknown {
  if (typeof stored !== "object" || stored === null || Array.isArray(stored)) return stored;
  // #240.
  return { spinUpDelay: DEFAULT_SPIN_UP_DELAY, ...stored };
}

/**
 * Copies the profile fields out of a database row, dropping columns such as
 * `id` and `userId`. Doesn't validate, so a row that fails rules added since
 * it was saved can still be shown in the form and fixed.
 */
export function machineFields(row: Machine): Machine {
  return Object.fromEntries(MACHINE_FIELDS.map((key) => [key, row[key]])) as Machine;
}
