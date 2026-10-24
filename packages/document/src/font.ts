import { z } from "zod";
import { Sha256 } from "./model";

/** The largest font file a project takes, in bytes (ADR-0062). */
export const MAX_FONT_BYTES = 5_000_000;

/** The most fonts a project holds (ADR-0062). */
export const MAX_PROJECT_FONTS = 4;

/**
 * A font uploaded into the project (PRD-0010 T7, ADR-0062). The file isn't in
 * the document: it is a project asset named by the SHA-256 of its bytes, as a
 * model's mesh is (ADR-0029). A text item uses it by that hash.
 */
export const ProjectFont = z.strictObject({
  /** Hash of the font file, the key of its project asset. */
  sha256: Sha256,
  /** Name of the uploaded file. */
  fileName: z.string(),
  /** The family name the font gives, to show without downloading it. */
  name: z.string(),
  /** Size of the font file in bytes. */
  size: z.number().int().positive().max(MAX_FONT_BYTES),
  /** Draws each stroke once, for engraving (ADR-0061): the user says so on upload. */
  singleStroke: z.boolean(),
});
export type ProjectFont = z.infer<typeof ProjectFont>;
