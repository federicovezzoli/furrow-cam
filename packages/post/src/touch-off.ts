import { stockOffset } from "@furrow/cam-core";
import type { Stock, TouchOffDisc } from "@furrow/document";
import { formatNumber } from "./format";

/**
 * A project's tool change on its touch-off pad (ADR-0043): G-code that
 * replaces the machine's tool change, where `{padX}` and `{padY}` stand for
 * the pad's centre in work coordinates and `{safeZ}` for the machine's safe
 * Z, so the block follows the pad and the machine.
 */

/** The placeholders a pad's tool change may use. */
export const TOUCH_OFF_PLACEHOLDERS = ["{padX}", "{padY}", "{safeZ}"] as const;

/**
 * `block` with the placeholders replaced by `pad`'s centre, in work
 * coordinates, and by `safeZ`.
 */
export function fillTouchOffBlock(
  block: string,
  stock: Stock,
  { x, y }: TouchOffDisc,
  safeZ: number,
): string {
  const [ox, oy] = stockOffset(stock);
  return block
    .replaceAll("{padX}", formatNumber(x + ox))
    .replaceAll("{padY}", formatNumber(y + oy))
    .replaceAll("{safeZ}", formatNumber(safeZ));
}

const MOVE = /G0?[01](?!\d)/i;
const MACHINE_COORDINATES = /G53(?!\d)/i;
/** `G90` or `G91`, not their arc modes `G90.1` and `G91.1`. */
const DISTANCE_MODE = /G9([01])(?![.\d])/gi;
/** Where a tool change zeroes Z: a pause or a probe. */
const ZEROING = /M0?[01](?!\d)|G38\.\d/i;
const X_WORD = /X\s*[-+]?(\d+\.?\d*|\.\d+)/i;
const Y_WORD = /Y\s*[-+]?(\d+\.?\d*|\.\d+)/i;
/** What's left of a move once its X and Y are gone, if it no longer moves. */
const EMPTY_MOVE = /^\s*((G0?[01](?!\d)|F\s*[\d.]+)\s*)*$/i;

/**
 * A pad's tool change to start from: the machine's `toolChange` block with
 * the tool put over the pad before it zeroes Z (its first pause or probe),
 * every other command as it was. The first move to an X or Y in work
 * coordinates, absolute, goes to the pad; the other XY moves before the
 * zeroing lose their X and Y, so the tool stays there. A relative first move
 * is replaced by an absolute one to the pad, `G91` restored after it. A
 * block with no such move gets a rise to `{safeZ}` and a move over the pad
 * before it; without a block, it is the default tool change with the move.
 * The post fills the placeholders in, so the block follows the machine's
 * safe Z as it is when the program is exported.
 */
export function suggestTouchOffToolChange(toolChange: string | null): string {
  const rise = "G0 Z{safeZ}";
  const move = "G0 X{padX} Y{padY}";
  if (toolChange === null) {
    return ["M5", rise, move, "M0 (Change the bit and zero Z on the touch-off pad)"].join("\n");
  }
  const lines = toolChange.split("\n");
  const zeroing = lines.findIndex((line) => ZEROING.test(codeOf(line)));
  const end = zeroing === -1 ? lines.length : zeroing;
  const suggested: string[] = [];
  let relative = false;
  let placed = false;
  lines.forEach((line, i) => {
    const code = codeOf(line);
    const comment = line.slice(code.length);
    const mode = [...code.matchAll(DISTANCE_MODE)].at(-1);
    if (mode) relative = mode[1] === "1";
    const movesXY =
      i < end &&
      MOVE.test(code) &&
      !MACHINE_COORDINATES.test(code) &&
      (X_WORD.test(code) || Y_WORD.test(code));
    if (!movesXY) {
      suggested.push(line);
      return;
    }
    if (!placed && !relative) {
      placed = true;
      suggested.push(onPad(code) + comment);
      return;
    }
    if (!placed) {
      placed = true;
      suggested.push(`G90 ${move}`, "G91");
    }
    // Its other words (a Z, a feed) still apply; a move left with none goes.
    const rest = code.replace(X_WORD, "").replace(Y_WORD, "").replace(/\s+/g, " ").trim();
    if (!EMPTY_MOVE.test(rest)) suggested.push(rest + comment);
  });
  return placed ? suggested.join("\n") : [rise, move, toolChange].join("\n");
}

/** An absolute move's `code` with its X and Y on the pad, adding the axis it lacks. */
function onPad(code: string): string {
  if (!X_WORD.test(code)) return code.replace(Y_WORD, "X{padX} Y{padY}");
  const x = code.replace(X_WORD, "X{padX}");
  return Y_WORD.test(x) ? x.replace(Y_WORD, "Y{padY}") : x.replace("X{padX}", "X{padX} Y{padY}");
}

/** A line's G-code before any comment. */
function codeOf(line: string): string {
  const end = line.search(/[(;]/);
  return end === -1 ? line : line.slice(0, end);
}
