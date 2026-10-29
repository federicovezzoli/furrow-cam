import type { SimulationCut, ToolpathLines } from "@furrow/cam-core";
import { clearingTool, type Operation, type StockSide, type Tool } from "@furrow/document";
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
 * changes exactly when the moves may. They are `side`'s operations; on the
 * bottom side of a two-sided project, `before` holds the top side's cuts,
 * which leave the stock the bottom side's start from (ADR-0060).
 */
export function playbackMoves(
  operations: readonly Operation[],
  entries: ToolpathState["entries"],
  side: StockSide = "top",
): {
  key: string;
  cuts: SimulationCut[];
  parts: PlaybackPart[];
  before?: SimulationCut[];
} | null {
  const cuts: SimulationCut[] = [];
  const parts: PlaybackPart[] = [];
  const before: SimulationCut[] = [];
  const hashes: Record<StockSide, string[]> = { top: [], bottom: [] };
  let firstMove = 0;
  function add(
    operationId: string,
    name: string,
    tool: Tool,
    lines: ToolpathLines,
    clearing: boolean,
    otherSide: boolean,
  ) {
    const moves = lines.kinds.length;
    if (moves === 0) return;
    const { type, diameter, vAngle, tipDiameter } = tool;
    const cut = { tool: { type, diameter, vAngle, tipDiameter }, segments: orderedSegments(lines) };
    if (otherSide) {
      before.push(cut);
      return;
    }
    cuts.push(cut);
    const rapidsBefore = new Uint32Array(moves + 1);
    for (let i = 0; i < moves; i++) {
      rapidsBefore[i + 1] = (rapidsBefore[i] as number) + (lines.kinds[i] as number);
    }
    parts.push({
      operationId,
      name,
      clearing,
      color: tool.color,
      lines,
      firstMove,
      moves,
      rapidsBefore,
    });
    firstMove += moves;
  }
  for (const operation of operations) {
    if (!operation.enabled) continue;
    // The top side's cut first, so the bottom side's start from them.
    if (operation.stockSide === "bottom" && side === "top") continue;
    const entry = entries[operation.id];
    if (!entry || entry.status === "computing") return null;
    if (entry.status === "error") continue;
    hashes[operation.stockSide].push(entry.inputHash);
    const otherSide = operation.stockSide !== side;
    const clearing = clearingTool(operation);
    if (clearing && entry.clearing) {
      add(operation.id, `${operation.name}, clearing`, clearing, entry.clearing, true, otherSide);
    }
    add(operation.id, operation.name, operation.tool, entry.lines, false, otherSide);
  }
  return side === "top"
    ? { key: JSON.stringify(hashes.top), cuts, parts }
    : { key: JSON.stringify([hashes.top, side, hashes.bottom]), cuts, parts, before };
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
