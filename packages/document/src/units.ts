import { z } from "zod";

/** Display units. All lengths are stored in millimetres regardless (ADR-0007). */
export const Units = z.enum(["mm", "in"]);
export type Units = z.infer<typeof Units>;

/** A length in millimetres that must be greater than zero. */
export const PositiveLength = z.number().positive();

/** A feed rate in millimetres per minute. */
export const FeedRate = z.number().positive();

/** A spindle speed in revolutions per minute. */
export const SpindleRpm = z.number().int().positive();

/** A display name that isn't blank. Not trimmed, so parsing never changes stored values. */
export const Name = z.string().regex(/\S/, "Must not be blank");
