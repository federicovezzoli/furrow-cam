import { stockOffset } from "@furrow/cam-core";
import type { Stock, TouchOffDisc } from "@furrow/document";
import { formatNumber } from "./format";

/**
 * A project's tool change on its touch-off pad (ADR-0043): G-code that
 * replaces the machine's tool change, where `{padX}` and `{padY}` stand for
 * the pad's centre in work coordinates, so the block follows the pad.
 */

/** The placeholders a pad's tool change may use. */
export const TOUCH_OFF_PLACEHOLDERS = ["{padX}", "{padY}"] as const;

/** `block` with the placeholders replaced by `pad`'s centre, in work coordinates. */
export function fillTouchOffBlock(block: string, stock: Stock, { x, y }: TouchOffDisc): string {
  const [ox, oy] = stockOffset(stock);
  return block
    .replaceAll("{padX}", formatNumber(x + ox))
    .replaceAll("{padY}", formatNumber(y + oy));
}

const MOVE = /G0?[01](?!\d)/i;
const MACHINE_COORDINATES = /G53(?!\d)/i;
const X_WORD = /X\s*[-+]?(\d+\.?\d*|\.\d+)/i;
const Y_WORD = /Y\s*[-+]?(\d+\.?\d*|\.\d+)/i;

/** Whether `code` (a line without its comment) is a `G0`/`G1` move to an X and Y in work coordinates. */
function isWorkXYMove(code: string): boolean {
  return (
    MOVE.test(code) && !MACHINE_COORDINATES.test(code) && X_WORD.test(code) && Y_WORD.test(code)
  );
}

/**
 * A pad's tool change to start from: the machine's `toolChange` block with
 * the X and Y of its first move in work coordinates put on the pad, every
 * other line and word as it was. A block that moves to no XY in work
 * coordinates gets a rise to `safeZ` and a move over the pad before it;
 * without a block, it is the default tool change with the move.
 */
export function suggestTouchOffToolChange(toolChange: string | null, safeZ: number): string {
  const rise = `G0 Z${formatNumber(safeZ)}`;
  const move = "G0 X{padX} Y{padY}";
  if (toolChange === null) {
    return ["M5", rise, move, "M0 (Change the bit and zero Z on the touch-off pad)"].join("\n");
  }
  const lines = toolChange.split("\n");
  const index = lines.findIndex((line) => isWorkXYMove(codeOf(line)));
  if (index === -1) return [rise, move, toolChange].join("\n");
  const line = lines[index] as string;
  const code = codeOf(line);
  lines[index] =
    code.replace(X_WORD, "X{padX}").replace(Y_WORD, "Y{padY}") + line.slice(code.length);
  return lines.join("\n");
}

/** A line's G-code before any comment. */
function codeOf(line: string): string {
  const end = line.search(/[(;]/);
  return end === -1 ? line : line.slice(0, end);
}
