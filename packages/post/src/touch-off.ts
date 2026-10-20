import { stockOffset } from "@furrow/cam-core";
import type { Stock, TouchOffDisc } from "@furrow/document";
import { formatNumber } from "./format";

/**
 * The placeholders the post fills in a custom block, the machine's or a
 * pad's tool change (ADR-0043), so the block follows the pad and the
 * machine's safe Z, with what each stands for, measured from the zero.
 */
export const PLACEHOLDERS = {
  "{padX}": "the touch-off pad's centre X",
  "{padY}": "the touch-off pad's centre Y",
  "{safeZ}": "the machine's safe Z",
} as const;

/**
 * `block` with the placeholders filled in, in work coordinates: `{safeZ}`
 * always, `{padX}` and `{padY}` when there is a `pad`.
 */
export function fillPlaceholders(
  block: string,
  stock: Stock,
  pad: TouchOffDisc | null,
  safeZ: number,
): string {
  const [ox, oy, oz] = stockOffset(stock);
  const filled = block.replaceAll("{safeZ}", formatNumber(safeZ + oz));
  if (!pad) return filled;
  return filled
    .replaceAll("{padX}", formatNumber(pad.x + ox))
    .replaceAll("{padY}", formatNumber(pad.y + oy));
}

/** What looks like a placeholder in a filled-in block: one it doesn't know, or a pad's without one. */
export function unfilledPlaceholders(block: string): string[] {
  return [...new Set(block.match(/\{[^{}\s]*\}/g))];
}

/** A motion mode word, `G0` to `G3` (or `G00` to `G03`), and its number. */
const MOTION = /G0?([0-3])(?![.\d])/gi;
/** A motion mode that isn't a straight move or an arc: a probe, or none. */
const OTHER_MOTION = /G38\.\d|G80(?!\d)/i;
const MACHINE_COORDINATES = /G53(?!\d)/gi;
/** A move to a stored position, through the given axes if any: `G28` or `G30`. */
const STORED_POSITION = /G(28|30)(?![.\d])/gi;
/** Commands whose axis words set something rather than move: offsets, stored positions. */
const SETS_AXES = /G(10|92)(?!\d)|G(28|30)\.1/i;
/** `G90` or `G91`, not their arc modes `G90.1` and `G91.1`. */
const DISTANCE_MODE = /G9([01])(?![.\d])/gi;
/** Where a tool change zeroes Z: a pause or a probe. */
const ZEROING = /M0?[01](?!\d)|G38\.\d/i;
const X_WORD = /X\s*[-+]?(\d+\.?\d*|\.\d+)/i;
const Y_WORD = /Y\s*[-+]?(\d+\.?\d*|\.\d+)/i;
const AXIS_WORD = /[XYZABC]\s*[-+]?(\d+\.?\d*|\.\d+)/i;
/** An arc's centre or radius. */
const ARC_WORDS = /[IJKR]\s*[-+]?(\d+\.?\d*|\.\d+)/gi;

/**
 * A pad's tool change to start from: the machine's `toolChange` block with
 * the tool put over the pad before it zeroes Z (its first pause or probe),
 * every other command as it was (ADR-0043, ADR-0053). XY moves are explicit
 * or modal straight moves and arcs, in work or machine coordinates (`G53`),
 * and moves to a stored position (`G28`, `G30`). The block starts in a
 * straight-move mode, as the program leaves it. The first absolute straight
 * move in work coordinates to an X or Y before the zeroing goes to the pad.
 * Any other first XY move is replaced by a move to the pad, absolute (`G91`
 * restored after it), after the move's other axes; a `G28` or `G30` with no
 * axis words, which moves every axis, by a rise to `{safeZ}` and the move. The
 * other XY moves before the zeroing lose their X and Y, so the tool stays
 * there: an arc becomes a straight move of its other axes, and a `G28` or
 * `G30` with no axis words a rise. A line whose move goes keeps its other
 * words (`G90`, `G91`, `F`, `S`, `M`) and its comment, and the block's motion
 * mode is written again before the zeroing where the changes left another.
 * A block with no XY move before the zeroing gets a rise to `{safeZ}` and a
 * move over the pad before it; without a block, it is the default tool
 * change with the move. The post fills the placeholders in, so the block
 * follows the machine's safe Z as it is when the program is exported.
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
  /** The block's modal motion: `0` to `3` for `G0` to `G3`, `null` for any other. */
  let motion: number | null = 0;
  /** The modal motion the suggested lines leave. */
  let written: number | null = 0;
  let placed = false;
  const push = (...added: string[]) => {
    for (const line of added) {
      suggested.push(line);
      written = motionAfter(codeOf(line), written);
    }
  };
  lines.forEach((line, i) => {
    const code = codeOf(line);
    const comment = line.slice(code.length);
    const mode = [...code.matchAll(DISTANCE_MODE)].at(-1);
    if (mode) relative = mode[1] === "1";
    motion = motionAfter(code, motion);
    // Lines after the zeroing run in the block's own mode, which a straight one can be set to.
    if (i === end && placed && written !== motion && (motion === 0 || motion === 1)) {
      push(`G${motion}`);
    }
    const xy = X_WORD.test(code) || Y_WORD.test(code);
    const stored = has(STORED_POSITION, code);
    const axes = AXIS_WORD.test(code);
    const movesXY = stored ? xy || !axes : xy && motion !== null && !SETS_AXES.test(code);
    if (i >= end || !movesXY) {
      push(line);
      return;
    }
    // A straight move or an arc: `movesXY` needs a known motion for anything but `G28`/`G30`.
    const kind = motion ?? 0;
    // `relative` holds while the pad move is written, which must be absolute.
    const absolute = (...moves: string[]) =>
      relative ? [`G90 ${moves[0]}`, ...moves.slice(1), "G91"] : moves;
    const first = !placed;
    placed = true;
    if (stored && !axes) {
      // Its other words (an `M5`, a `G90`) and comment still apply.
      const others = words(code, STORED_POSITION);
      if (others) push(withComment(others, comment));
      push(...absolute(others ? rise : withComment(rise, comment), ...(first ? [move] : [])));
      return;
    }
    if (first && !relative && !stored && kind <= 1 && !has(MACHINE_COORDINATES, code)) {
      push(onPad(code) + comment);
      return;
    }
    // Its other axes (a Z) still move, an arc's as a straight move, and its other words apply.
    let rest = words(code, X_WORD, Y_WORD);
    if (!stored && kind >= 2) rest = words(rest.replace(MOTION, "G1"), ARC_WORDS);
    if (!AXIS_WORD.test(rest)) rest = words(rest, MOTION, STORED_POSITION, MACHINE_COORDINATES);
    if (rest || comment.trim()) push(withComment(rest, comment));
    if (first) push(...absolute(move));
  });
  return placed ? suggested.join("\n") : [rise, move, toolChange].join("\n");
}

/** The modal motion after `code`, from `current`: `0` to `3` for `G0` to `G3`, `null` for any other. */
function motionAfter(code: string, current: number | null): number | null {
  const word = [...code.matchAll(MOTION)].at(-1);
  if (word) return Number(word[1]);
  return OTHER_MOTION.test(code) ? null : current;
}

/** A rebuilt line's `code` with the original line's comment, one space between. */
function withComment(code: string, comment: string): string {
  return [code, comment.trim()].filter(Boolean).join(" ");
}

/** Whether global `pattern` matches `text`. */
function has(pattern: RegExp, text: string): boolean {
  pattern.lastIndex = 0;
  return pattern.test(text);
}

/** `code` without the words `patterns` match, spaced singly. */
function words(code: string, ...patterns: RegExp[]): string {
  return patterns
    .reduce((rest, pattern) => rest.replace(new RegExp(pattern.source, "gi"), ""), code)
    .replace(/\s+/g, " ")
    .trim();
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
