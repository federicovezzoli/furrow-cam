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
  /** Whether the other side has a file too, i.e. something to cut. */
  other: boolean;
  /** Whether the top side's file drills the locating pins (#356) to turn the stock over onto. */
  pins: boolean;
};

/** The custom blocks, as warnings name them. */
export type BlockLabel =
  | "programStart"
  | "toolChangePad"
  | "toolChange"
  | "operationStart"
  | "programEnd";

/** Lines `first` to `last` (1-based) of a program: one custom block, named by `label`. */
export type CustomBlock = { label: BlockLabel; first: number; last: number };

export type PostOutput = {
  /** The program, one block per line, ending with a newline. */
  gcode: string;
  /** Where each step went in it, in cutting order (`postSteps`). */
  steps: ProgramStep[];
  /** The machine's custom blocks in it, by line. */
  blocks: CustomBlock[];
  /** Things the user should know, e.g. feeds lowered to the machine's limits. */
  warnings: PostWarning[];
};

/** What exporting says (ADR-0054); toolpath warnings pass through as theirs. */
export const POST_MESSAGES = [
  "export.allHidden",
  "export.exceedsTravel",
  "export.noEnabled",
  "export.noneHasToolpath",
  "export.noToolpath",
  "export.notFinite",
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
 * Turns toolpaths into a G-code dialect (PRD-0001 R12, ADR-0091). A new
 * dialect is a folder with its `Dialect`, registered in `POST_PROCESSORS`, and
 * a new `PostProcessorId` in the document schema.
 */
export type PostProcessor = {
  id: PostProcessorId;
  /** How it writes comments, pauses and the rest, e.g. for a block shown before export. */
  dialect: Dialect;
  /** Extension of the exported file, with the dot. */
  extension: string;
  post(input: PostInput): PostOutput;
};

/** The moves of one operation cut with one tool: a block of the program. */
export type PostStep = {
  name: string;
  operationId: string;
  /** Whether these are the operation's clearing moves (ADR-0026). */
  clearing: boolean;
  tool: Tool;
  moves: ToolpathMove[];
};

/**
 * Where a step went in its program, for following its toolpath as the
 * program plays (#683): the line it starts on, and the line of each of its
 * moves, the line before for a move rounding left out. 1-based.
 */
export type ProgramStep = {
  operationId: string;
  clearing: boolean;
  first: number;
  moveLines: Uint32Array;
};

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
        operationId: operation.id,
        clearing: true,
        tool: clearing,
        moves: toolpath.clearing,
      });
    }
    if (toolpath.moves.length > 0) {
      steps.push({
        name: operation.name,
        operationId: operation.id,
        clearing: false,
        tool: operation.tool,
        moves: toolpath.moves,
      });
    }
    return steps;
  });
}

/**
 * How a G-code dialect writes what every program says (ADR-0091). Each
 * dialect folder fills one in; what they all do is `postProgram`'s
 * (`program/program.ts`).
 */
export type Dialect = {
  /** A comment, which can't nest or span lines. */
  comment(text: string): string;
  /** The lines setting the modes every coordinate assumes: millimetres and absolute. */
  modes: string[];
  /** A wait of `seconds`. */
  dwell(seconds: number): string;
  /** A pause showing `message`, until the user resumes. */
  pause(message: string): string;
  /** The program's last lines, after the rise and the rapid to the XY zero. */
  end: string[];
  /** Whether `G0` runs at the last `F`, so each carries the machine's maximum XY feed. */
  rapidFeed: boolean;
};
