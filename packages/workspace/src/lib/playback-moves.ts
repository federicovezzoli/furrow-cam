import type { PlaybackPath, SimulationCut, ToolpathLines } from "@furrow/cam-core";
import { clearingTool, type FlipAxis, type Operation, type StockSide } from "@furrow/document";
import type { CustomBlock, ProgramReadReason, ProgramStep, ProgramWarning } from "@furrow/post";
import type { Translatable } from "@furrow/ui/lib/i18n";
import { toolpathsBySide } from "../stores/simulation-scheduler";
import type { GcodeExportResult } from "../stores/toolpath-scheduler";
import type { ToolpathState } from "../stores/toolpath-store";

/**
 * One step of a played program (#683): an operation's clearing moves
 * (ADR-0026) or its own, cut with the tool coloured `color`. `firstMove`
 * numbers its first segment among all the program's, `moves` counts them,
 * from the line the step starts on to the next step's (the first step from
 * the program's start, the last to its end). `done[k]` counts the segments
 * of its toolpath `lines` the tool has made after `k` of the program's, and
 * `rapidsBefore[i]` the rapids among the toolpath's first `i` segments.
 */
export type PlaybackPart = {
  operationId: string;
  name: string;
  clearing: boolean;
  color: string;
  lines: ToolpathLines;
  firstMove: number;
  moves: number;
  done: Uint32Array;
  rapidsBefore: Uint32Array;
};

/**
 * What the program played back depends on, as `key`: the toolpaths of the
 * enabled operations of `side` (the one played back, the top side unless a
 * two-sided project, turned over about `flipAxis`, shows its bottom side)
 * and what else the post writes, `posted` (the machine's blocks, the stock's
 * zero). On the bottom side, `before` keys the top side's program, whose cuts
 * leave the stock the bottom side starts from (ADR-0060). Failed toolpaths
 * are left out, as the simulation leaves them out of the program; `null`
 * while any toolpath is computing.
 */
export function playbackKey(
  operations: readonly Operation[],
  entries: ToolpathState["entries"],
  shown: StockSide = "top",
  flipAxis: FlipAxis | null = null,
  posted: unknown = null,
): { key: string; side: StockSide; before?: string } | null {
  const side = flipAxis ? shown : "top";
  const sides = toolpathsBySide(operations, entries, side);
  if (!sides) return null;
  const topKey = JSON.stringify([sides.top.hashes, posted]);
  if (!flipAxis || side === "top") return { key: topKey, side };
  return { key: JSON.stringify([topKey, flipAxis, sides.bottom.hashes]), side, before: topKey };
}

/**
 * The parts of a program read back (ADR-0096) from where the post wrote its
 * `steps`, given the line of each of its segments (`segmentLines`, all
 * cuts' in a row, `moveLines`), with the names and colours of `operations` and the
 * toolpaths of `entries`. A step whose toolpath isn't ready is left out, its
 * segments going to the part before.
 */
export function programParts(
  steps: readonly ProgramStep[],
  segmentLines: Uint32Array,
  operations: readonly Operation[],
  entries: ToolpathState["entries"],
): PlaybackPart[] {
  const kept = steps.flatMap((step, i) => {
    const operation = operations.find((candidate) => candidate.id === step.operationId);
    const entry = entries[step.operationId];
    const toolpath =
      entry?.status === "ready" ? (step.clearing ? entry.clearing : entry.lines) : undefined;
    const tool = operation && (step.clearing ? clearingTool(operation) : operation.tool);
    if (!operation || !toolpath || !tool) return [];
    // The first part takes the program's start too.
    const firstMove = i === 0 ? 0 : firstAtOrAfter(segmentLines, step.first);
    return [{ step, operation, toolpath, color: tool.color, firstMove }];
  });
  return kept.map(({ step, operation, toolpath, color, firstMove }, i) => {
    const end = kept[i + 1]?.firstMove ?? segmentLines.length;
    const moves = end - firstMove;
    const segments = toolpath.kinds.length;
    const done = new Uint32Array(moves + 1);
    // Toolpath segment `j` ends at move `j + 1`, on line `moveLines[j + 1]`.
    let j = 0;
    for (let k = 1; k <= moves; k++) {
      const line = segmentLines[firstMove + k - 1] as number;
      while (j < segments && (step.moveLines[j + 1] ?? Infinity) <= line) j++;
      done[k] = j;
    }
    const rapidsBefore = new Uint32Array(segments + 1);
    for (let s = 0; s < segments; s++) {
      rapidsBefore[s + 1] = (rapidsBefore[s] as number) + (toolpath.kinds[s] as number);
    }
    return {
      operationId: operation.id,
      name: step.clearing ? `${operation.name}, clearing` : operation.name,
      clearing: step.clearing,
      color,
      lines: toolpath,
      firstMove,
      moves,
      done,
      rapidsBefore,
    };
  });
}

/** The line of each of a program's moves, all cuts' in a row, from the lines of each cut's. */
export function moveLines(lines: readonly Uint32Array[]): Uint32Array {
  const all = new Uint32Array(lines.reduce((total, cut) => total + cut.length, 0));
  let at = 0;
  for (const cut of lines) {
    all.set(cut, at);
    at += cut.length;
  }
  return all;
}

/** The line move `move` of `moves` (`moveLines`) comes from; the last one's past the end, none if none. */
export function lineOfMove(moves: Uint32Array, move: number): number | null {
  return moves.length === 0 ? null : (moves[Math.min(move, moves.length - 1)] as number);
}

/**
 * The first move from line `line` of the program (`moves`, `moveLines`) that
 * goes somewhere along `path`, or `null` if it has none: seeking to a move
 * that goes nowhere would land on the next one.
 */
export function firstMoveOfLine(
  moves: Uint32Array,
  path: Pick<PlaybackPath, "ends">,
  line: number,
): number | null {
  for (let move = firstAtOrAfter(moves, line); moves[move] === line; move++) {
    const start = move === 0 ? 0 : (path.ends[move - 1] as number);
    if ((path.ends[move] as number) > start) return move;
  }
  return null;
}

/** The index of the first of the ascending `values` at least `value`. */
function firstAtOrAfter(values: Uint32Array, value: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if ((values[middle] as number) < value) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** The part `move` (of the whole program) is in: the last one started. */
export function partAt(parts: readonly PlaybackPart[], move: number): PlaybackPart | undefined {
  return parts.findLast((part) => part.firstMove <= move) ?? parts[0];
}

/**
 * How many of `part`'s toolpath feed and rapid segments are done after
 * `move` segments of the whole program: all of them once it is past, none
 * before it starts.
 */
export function partProgress(part: PlaybackPart, move: number): { feeds: number; rapids: number } {
  const k = Math.min(Math.max(move - part.firstMove, 0), part.moves);
  const done = part.done[k] as number;
  const rapids = part.rapidsBefore[done] as number;
  return { feeds: done - rapids, rapids };
}

/** Why the program can't be played: it can't be posted, or read back past `line`. */
export type ProgramFailure =
  /** On the bottom side, `side` says the top side's program, which it plays over, is the one. */
  | { line: number; reason: ProgramReadReason; side?: "top" }
  | { error: Translatable; operation?: string };

/** The program played back (ADR-0096), as `usePlayback` keeps it. */
export type PlayedProgram = {
  key: string;
  side: StockSide;
  cuts: SimulationCut[];
  before?: { key: string; cuts: SimulationCut[]; axis: FlipAxis };
  steps: ProgramStep[];
  lines: Uint32Array[];
  /** The text of the program played, as Export saves it, and its custom blocks. */
  gcode: string;
  blocks: CustomBlock[];
  /** The top side's program's too on the bottom side, which it plays over (`side`). */
  warnings: (ProgramWarning & { side?: "top" })[];
  failure: ProgramFailure | null;
};

/** What an export of nothing says: no program to play, which the viewport says its own way. */
const NOTHING_TO_POST = new Set(["export.noEnabled", "export.allHidden", "export.noneHasToolpath"]);

/** The program `wanted` keys from the worker's `result`: the side it plays, and the top side's before it. */
export function playedProgram(
  wanted: NonNullable<ReturnType<typeof playbackKey>>,
  result: GcodeExportResult,
  flipAxis: FlipAxis | null,
): PlayedProgram {
  const played: PlayedProgram = {
    key: wanted.key,
    side: wanted.side,
    cuts: [],
    steps: [],
    lines: [],
    gcode: "",
    blocks: [],
    warnings: [],
    failure: null,
  };
  if ("error" in result) {
    const { error, operation } = result;
    const nothing = typeof error !== "string" && "code" in error && NOTHING_TO_POST.has(error.code);
    if (nothing) return played;
    return { ...played, failure: { error, ...(operation !== undefined && { operation }) } };
  }
  const playbacks = result.playbacks ?? [];
  const find = (side: StockSide) =>
    playbacks.find((playback) => playback.side === (flipAxis ? side : null));
  const file = result.files.find((each) => each.side === (flipAxis ? wanted.side : null));
  const text = { gcode: file?.gcode ?? "", blocks: file?.blocks ?? [] };
  const shown = find(wanted.side);
  const top = wanted.before !== undefined ? find("top") : undefined;
  const unread = [top, shown].find((playback) => playback !== undefined && "error" in playback);
  const failure =
    unread && "error" in unread
      ? { ...unread.error, ...(unread === top && unread !== shown && { side: "top" as const }) }
      : null;
  const before =
    wanted.before !== undefined && flipAxis
      ? { key: wanted.before, cuts: top && "cuts" in top ? top.cuts : [], axis: flipAxis }
      : undefined;
  if (!shown || !("cuts" in shown)) return { ...played, ...text, before, failure };
  const { cuts, steps, lines } = shown;
  const topWarnings = top && "warnings" in top ? top.warnings : [];
  const warnings = [
    ...topWarnings.map((warning) => ({ ...warning, side: "top" as const })),
    ...shown.warnings,
  ];
  return { ...played, ...text, cuts, steps, lines, warnings, before, failure };
}
