import type { Toolpath, ToolpathMessage, ToolpathMove } from "@furrow/cam-core";
import {
  clearingTool,
  type DocumentMessage,
  type Machine,
  type Message,
  MessageError,
  type Operation,
  type PostProcessorId,
  type Stock,
  type StockSide,
  type Tool,
} from "@furrow/document";

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
  /**
   * In a two-sided project, which side this program cuts and the other
   * side's file, for the header to say what to do between them (ADR-0060).
   */
  side?: SideSetup | null;
};

/** One side of a two-sided project's export. */
export type SideSetup = {
  side: StockSide;
  /** The other side's file, or `null` when that side has nothing to cut. */
  otherFile: string | null;
};

export type PostOutput = {
  /** The program, one block per line, ending with a newline. */
  gcode: string;
  /** Things the user should know, e.g. feeds lowered to the machine's limits. */
  warnings: PostWarning[];
};

/** What exporting says (ADR-0054); toolpath warnings pass through as theirs. */
export const POST_MESSAGES = [
  "export.bottomSide2d",
  "export.noEnabled",
  "export.noneHasToolpath",
  "export.noToolpath",
  "grbl.customBlockMove",
  "grbl.slowed",
  "grbl.spindleClamped",
  "grbl.unfilledPlaceholder",
] as const;

export type PostMessage = Message<(typeof POST_MESSAGES)[number]>;

/** A warning or error about the program, and the operation it is about, if any. */
export type PostWarning = {
  operation?: string;
  message: PostMessage | ToolpathMessage | DocumentMessage;
};

/** Why there is no program to export (ADR-0054); the `message` is the code. */
export class GcodeExportError extends MessageError<PostWarning["message"]> {
  constructor({ message, operation }: PostWarning) {
    super(message, operation);
  }
}

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

/** The moves of one operation cut with one tool: a block of the program. */
export type PostStep = { name: string; tool: Tool; moves: ToolpathMove[] };

/**
 * The steps of `operations`, in cutting order: each operation's own moves,
 * after its clearing moves with its clearing tool when it has them (ADR-0026),
 * named "<operation>, clearing". Steps with no moves are left out.
 */
export function postSteps(operations: PostInput["operations"]): PostStep[] {
  return operations.flatMap(({ operation, toolpath }) => {
    const steps: PostStep[] = [];
    const clearing = clearingTool(operation);
    if (clearing && toolpath.clearing && toolpath.clearing.length > 0) {
      steps.push({
        name: `${operation.name}, clearing`,
        tool: clearing,
        moves: toolpath.clearing,
      });
    }
    if (toolpath.moves.length > 0) {
      steps.push({ name: operation.name, tool: operation.tool, moves: toolpath.moves });
    }
    return steps;
  });
}
