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

/** A motion mode word, `G0` to `G3` (or `G00` to `G03`), and its number. */
const MOTION = /G0?([0-3])(?![.\d])/gi;
/** A motion mode that isn't a straight move or an arc: a probe, or none. */
const OTHER_MOTION = /G38\.\d|G80(?!\d)/i;
const MACHINE_COORDINATES = /G53(?!\d)/i;
/** A move to a stored position, through the given axes if any: `G28` or `G30`. */
const STORED_POSITION = /G(28|30)(?![.\d])/i;
/** Commands whose axis words set something rather than move: offsets, stored positions. */
const SETS_AXES = /G(10|92)(?!\d)|G(28|30)\.1/i;
/** `G90` or `G91`, not their arc modes `G90.1` and `G91.1`. */
const DISTANCE_MODE = /G9([01])(?![.\d])/gi;
/** Where a tool change zeroes Z: a pause or a probe. */
const ZEROING = /M0?[01](?!\d)|G38\.\d/i;
const X_WORD = /X\s*[-+]?(\d+\.?\d*|\.\d+)/i;
const Y_WORD = /Y\s*[-+]?(\d+\.?\d*|\.\d+)/i;
const AXIS_WORD = /[XYZABC]\s*[-+]?(\d+\.?\d*|\.\d+)/i;
/** What's left of a move once its X and Y are gone, if it no longer moves. */
const EMPTY_MOVE = /^\s*((G0?[01](?!\d)|G53|F\s*[\d.]+)\s*)*$/i;

/**
 * A pad's tool change to start from: the machine's `toolChange` block with
 * the tool put over the pad before it zeroes Z (its first pause or probe),
 * every other command as it was (ADR-0043, ADR-0051). XY moves are explicit
 * or modal straight moves and arcs, in work or machine coordinates (`G53`),
 * and moves to a stored position (`G28`, `G30`). The first absolute straight
 * move in work coordinates to an X or Y before the zeroing goes to the pad.
 * Any other first XY move is replaced by a move to the pad, absolute (`G91`
 * restored after it), after the move's other axes; a `G28` or `G30` with no
 * axis words, which moves every axis, by a rise to `safeZ` and the move. The
 * other XY moves before the zeroing lose their X and Y, so the tool stays
 * there: an arc goes, and so does a `G28` or `G30` left with no axis words.
 * A block with no XY move before the zeroing gets a rise to `safeZ` and a
 * move over the pad before it; without a block, it is the default tool
 * change with the move.
 */
export function suggestTouchOffToolChange(toolChange: string | null, safeZ: number): string {
  const rise = `G0 Z${formatNumber(safeZ)}`;
  const move = "G0 X{padX} Y{padY}";
  if (toolChange === null) {
    return ["M5", rise, move, "M0 (Change the bit and zero Z on the touch-off pad)"].join("\n");
  }
  const lines = toolChange.split("\n");
  const zeroing = lines.findIndex((line) => ZEROING.test(codeOf(line)));
  const end = zeroing === -1 ? lines.length : zeroing;
  const suggested: string[] = [];
  let relative = false;
  /** The modal motion: `0` to `3` for `G0` to `G3`, `null` for any other. */
  let motion: number | null = null;
  let placed = false;
  lines.forEach((line, i) => {
    const code = codeOf(line);
    const comment = line.slice(code.length);
    const mode = [...code.matchAll(DISTANCE_MODE)].at(-1);
    if (mode) relative = mode[1] === "1";
    const motionWord = [...code.matchAll(MOTION)].at(-1);
    if (motionWord) motion = Number(motionWord[1]);
    else if (OTHER_MOTION.test(code)) motion = null;
    const xy = X_WORD.test(code) || Y_WORD.test(code);
    const stored = STORED_POSITION.test(code);
    const movesXY = stored
      ? xy || !AXIS_WORD.test(code)
      : xy && motion !== null && !SETS_AXES.test(code);
    if (i >= end || !movesXY) {
      suggested.push(line);
      return;
    }
    // `relative` holds while the pad move is written, which must be absolute.
    const absolute = (...moves: string[]) =>
      relative ? [`G90 ${moves[0]}`, ...moves.slice(1), "G91"] : moves;
    if (stored && !AXIS_WORD.test(code)) {
      suggested.push(...absolute(rise, ...(placed ? [] : [move])));
      placed = true;
      return;
    }
    const first = !placed;
    placed = true;
    if (first && !relative && !stored && motion !== null && motion <= 1) {
      if (!MACHINE_COORDINATES.test(code)) {
        suggested.push(onPad(code) + comment);
        return;
      }
    }
    // Its other words (a Z, a feed) still apply; a move left with none goes.
    const rest = code.replace(X_WORD, "").replace(Y_WORD, "").replace(/\s+/g, " ").trim();
    const arc = !stored && motion !== null && motion >= 2;
    const keep = !arc && (stored ? AXIS_WORD.test(rest) : !EMPTY_MOVE.test(rest));
    if (keep) suggested.push(rest + comment);
    if (first) suggested.push(...absolute(move));
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
