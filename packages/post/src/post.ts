import type { Toolpath } from "@furrow/cam-core";
import type { Machine, Operation, PostProcessorId, Stock } from "@furrow/document";

/** Everything a post-processor needs to write one program. */
export type PostInput = {
  /** The project's name, written in the header. */
  name: string;
  /** Where the work origin is: toolpaths are in stock coordinates (ADR-0014). */
  stock: Stock;
  /** The project's machine snapshot, or `null` for none. */
  machine: Machine | null;
  /** Retract height above the stock top, the one the toolpaths were generated with. */
  safeZ: number;
  /** The operations to cut with their toolpaths, in cutting order. */
  operations: { operation: Operation; toolpath: Toolpath }[];
};

export type PostOutput = {
  /** The program, one block per line, ending with a newline. */
  gcode: string;
  /** Things the user should know, e.g. feeds lowered to the machine's limits. */
  warnings: string[];
};

/**
 * Turns toolpaths into a G-code dialect (PRD-0001 R12). A new dialect is a
 * new implementation registered in `POST_PROCESSORS` and a new
 * `PostProcessorId` in the document schema.
 */
export type PostProcessor = {
  id: PostProcessorId;
  /** Extension of the exported file, with the dot. */
  extension: string;
  post(input: PostInput): PostOutput;
};
