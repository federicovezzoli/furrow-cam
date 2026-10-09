import { z } from "zod";

/** Display units. All lengths are stored in millimetres regardless (ADR-0007). */
export const Units = z.enum(["mm", "in"]);
export type Units = z.infer<typeof Units>;

/** A length in millimetres that must be greater than zero. */
export const PositiveLength = z.number().positive();

/** A feed rate in millimetres per minute. */
export const FeedRate = z.number().positive();

/**
 * A spindle speed in revolutions per minute. Capped well above any router
 * spindle, which also keeps it within a 32-bit `INTEGER` column.
 */
export const SpindleRpm = z.number().int().positive().max(100_000, "Must be at most 100,000 RPM");

/** A display name that isn't blank. Not trimmed, so parsing never changes stored values. */
export const Name = z.string().regex(/\S/, "Must not be blank");
