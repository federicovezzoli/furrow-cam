import type { SimulationCut, ToolpathLines } from "@furrow/cam-core";
import type { FlipAxis, Operation, StockSide, Tool } from "@furrow/document";
import { toolpathsBySide } from "../stores/simulation-scheduler";
import type { ToolpathState } from "../stores/toolpath-store";

/**
 * One tool's moves of an operation in a playback: its clearing moves
 * (ADR-0026) or its own, cut with the tool coloured `color`. `firstMove`
 * numbers its first move among all the playback's, `moves` counts them.
 * `rapidsBefore[i]` counts the rapids among its first `i` moves.
 */
export type PlaybackPart = {
  operationId: string;
  name: string;
  clearing: boolean;
  color: string;
  lines: ToolpathLines;
  firstMove: number;
  moves: number;
  rapidsBefore: Uint32Array;
};

/**
 * The toolpaths of the enabled `operations` in the order they are cut,
 * for playing them back (#100): `cuts` (one per part, rapids included, in the
 * order the tool makes them) and the `parts` they came from. Like the
 * simulation (ADR-0019), clearing moves come first with the clearing tool,
 * operations whose toolpath failed are left out, hidden toolpaths still cut,
 * and nothing is played back while any toolpath is computing (`null`). `key`
 * changes exactly when the moves may. They are the operations of `side`, the
 * one played back: the top side unless a two-sided project, turned over
 * about `flipAxis`, shows its bottom side. There, `before` holds the top
 * side's cuts, which leave the stock the bottom side's start from (ADR-0060),
 * and `before.key` changes exactly when they may.
 */
export function playbackMoves(
  operations: readonly Operation[],
  entries: ToolpathState["entries"],
  shown: StockSide = "top",
  flipAxis: FlipAxis | null = null,
): {
  key: string;
  side: StockSide;
  cuts: SimulationCut[];
  parts: PlaybackPart[];
  before?: { key: string; cuts: SimulationCut[]; axis: FlipAxis };
} | null {
  const side = flipAxis ? shown : "top";
  const sides = toolpathsBySide(operations, entries, side);
  if (!sides) return null;
  const cuts: SimulationCut[] = [];
  const parts: PlaybackPart[] = [];
  let firstMove = 0;
  for (const { operation, tool, lines, clearing } of sides[side].runs) {
    const moves = lines.kinds.length;
    if (moves === 0) continue;
    cuts.push(toolCut(tool, lines));
    const rapidsBefore = new Uint32Array(moves + 1);
    for (let i = 0; i < moves; i++) {
      rapidsBefore[i + 1] = (rapidsBefore[i] as number) + (lines.kinds[i] as number);
    }
    parts.push({
      operationId: operation.id,
      name: clearing ? `${operation.name}, clearing` : operation.name,
      clearing,
      color: tool.color,
      lines,
      firstMove,
      moves,
      rapidsBefore,
    });
    firstMove += moves;
  }
  const topKey = JSON.stringify(sides.top.hashes);
  if (!flipAxis || side === "top") return { key: topKey, side, cuts, parts };
  const before = {
    key: topKey,
    cuts: sides.top.runs.map(({ tool, lines }) => toolCut(tool, lines)),
    axis: flipAxis,
  };
  return {
    key: JSON.stringify([topKey, flipAxis, sides.bottom.hashes]),
    side,
    cuts,
    parts,
    before,
  };
}

/** The moves of `lines` made with `tool`, in the order the tool makes them. */
function toolCut(
  { type, diameter, vAngle, tipDiameter }: Tool,
  lines: ToolpathLines,
): SimulationCut {
  return { tool: { type, diameter, vAngle, tipDiameter }, segments: orderedSegments(lines) };
}

/** The segments of `lines`, feeds and rapids together, in the order the tool makes them. */
export function orderedSegments({ feeds, rapids, kinds }: ToolpathLines): Float32Array {
  const segments = new Float32Array(kinds.length * 6);
  let f = 0;
  let r = 0;
  for (let i = 0; i < kinds.length; i++) {
    if (kinds[i] === 1) {
      segments.set(rapids.subarray(r, r + 6), i * 6);
      r += 6;
    } else {
      segments.set(feeds.subarray(f, f + 6), i * 6);
      f += 6;
    }
  }
  return segments;
}

/**
 * How many of `part`'s feed and rapid segments are done after `move` moves
 * of the whole playback: all of them once it is past, none before it starts.
 */
export function partProgress(part: PlaybackPart, move: number): { feeds: number; rapids: number } {
  const done = Math.min(Math.max(move - part.firstMove, 0), part.moves);
  const rapids = part.rapidsBefore[done] as number;
  return { feeds: done - rapids, rapids };
}
