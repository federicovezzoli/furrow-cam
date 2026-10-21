// Reads a posted program back: its blocks, its moves and the material they
// pass through (#149). The e2e corpus checks every program with it; export
// checks the moves of the machine's custom blocks with it (#179).
import {
  type CutterProfile,
  cutterProfile,
  type HeightmapGrid,
  heightmapGrid,
  stockBounds,
  stockOffset,
  sweepMoves,
  type Vec3,
} from "@furrow/cam-core";
import { clearingTool, type ProjectDocument, type Tool } from "@furrow/document";
import { formatNumber } from "./format";
import type { PostWarning } from "./post";

/** Distance below which two coordinates count as equal: the programs' last decimal. */
export const EPSILON = 1e-3;

/**
 * How far into the material left a rapid may seem to pass before it counts:
 * the heightmap's cells see the stock a little higher than the toolpaths'
 * own grids do, on slopes.
 */
export const MATERIAL_TOLERANCE = 0.05;

/** One block of a program: its words, letter and value, and its comment. */
export type GcodeLine = {
  /** 1-based, as editors number lines. */
  number: number;
  text: string;
  words: { letter: string; value: number }[];
  comment: string | null;
};

/** A G0 or G1 the program makes, in work coordinates. */
export type GcodeMove = {
  line: number;
  kind: "rapid" | "feed";
  /** An axis is `NaN` until the program sets it. */
  from: Vec3;
  to: Vec3;
  /** The active feed rate, for feeds. */
  feedRate: number | null;
};

/** What a program is read against: the project it was posted from. */
export type CheckedProject = Pick<ProjectDocument, "stock" | "machine" | "operations">;

/** The custom blocks, as warnings name them. */
export type BlockLabel =
  | "programStart"
  | "toolChangePad"
  | "toolChange"
  | "operationStart"
  | "programEnd";

/** Lines `first` to `last` (1-based) of a program: one custom block, named by `label`. */
export type CustomBlock = { label: BlockLabel; first: number; last: number };

/** What a custom block's move does, as `grbl.customBlockMove` says it. */
type BlockProblem = "material" | "belowBottom" | "unknownPosition" | "unreadable" | "unfollowed";

/** Splits `gcode` into blocks, throwing on text that isn't G-code. */
export function parseGcode(gcode: string): GcodeLine[] {
  return gcode
    .replace(/\n$/, "")
    .split("\n")
    .map((text, i) => {
      const number = i + 1;
      const comments = [...text.matchAll(/\(([^)]*)\)/g)].map((match) => match[1]);
      const code = text.replace(/\([^)]*\)/g, " ").trim();
      const words: GcodeLine["words"] = [];
      for (const token of code.split(/\s+/).filter(Boolean)) {
        const match = /^([A-Z])(-?\d+(?:\.\d+)?)$/.exec(token);
        if (!match) throw new Error(`line ${number}: "${token}" isn't a G-code word`);
        words.push({ letter: match[1] as string, value: Number(match[2]) });
      }
      return { number, text, words, comment: comments.length > 0 ? comments.join(" ") : null };
    });
}

/**
 * The moves of a program, starting from an unknown position. Coordinates are
 * absolute unless `G91` makes them relative.
 */
export function gcodeMoves(lines: GcodeLine[]): GcodeMove[] {
  const moves: GcodeMove[] = [];
  let position: Vec3 = [Number.NaN, Number.NaN, Number.NaN];
  let motion: "rapid" | "feed" | null = null;
  let relative = false;
  let feedRate: number | null = null;
  for (const line of lines) {
    const target: Vec3 = [...position];
    let moved = false;
    for (const { letter, value } of line.words) {
      if (letter === "G" && value === 0) motion = "rapid";
      else if (letter === "G" && value === 1) motion = "feed";
      else if (letter === "G" && value === 90) relative = false;
      else if (letter === "G" && value === 91) relative = true;
      else if (letter === "F") feedRate = value;
      else if (letter === "X" || letter === "Y" || letter === "Z") {
        const axis = "XYZ".indexOf(letter);
        target[axis] = relative ? (target[axis] as number) + value : value;
        moved = true;
      }
    }
    if (!moved || motion === null) continue;
    moves.push({
      line: line.number,
      kind: motion,
      from: position,
      to: target,
      feedRate: motion === "feed" ? feedRate : null,
    });
    position = target;
  }
  return moves;
}

/** A word with an optional sign and a number GRBL accepts: `X.5`, `z -2.`. */
const LOOSE_WORD = /([A-Z])\s*([+-]?(?:\d+\.?\d*|\.\d+))/g;

/**
 * Commands after which `gcodeMoves` can't tell where the tool is: arcs,
 * probing, machine coordinates, stored positions, offsets, work coordinate
 * systems and inches.
 */
const UNFOLLOWED = new Set([2, 3, 10, 20, 28, 30, 38, 43, 53, 54, 55, 56, 57, 58, 59, 92]);

/**
 * A warning for each move in or after one of `blocks` (the machine's custom
 * G-code, in the program `gcode` posted from `project`) that goes below the
 * stock top through material not cut away before it, or below the stock
 * bottom. The program's own feeds cut, and its own rapids are checked as the
 * custom blocks' moves are, since a block may leave the tool anywhere. Words
 * that don't move the tool are skipped; from a command after which the
 * position is unknown (`G53`, `G38.2`…) on, nothing is checked, and one
 * warning says so.
 */
export function customBlockWarnings(
  gcode: string,
  project: CheckedProject,
  blocks: readonly CustomBlock[],
): PostWarning[] {
  if (blocks.length === 0) return [];
  const blockAt = (line: number) => blocks.findLast(({ first }) => first <= line);
  /** `problem` at `line`, named by the custom block it is in or after; `null` before any. */
  const warning = (line: number, problem: BlockProblem, amount = 0): PostWarning | null => {
    const block = blockAt(line);
    if (!block) return null;
    const after = line > block.last ? "yes" : "no";
    const values = { block: block.label, after, line, problem, amount };
    return { message: { code: "grbl.customBlockMove", values } };
  };

  // Custom blocks are written by hand: lowercase, `;` comments, `G0Z5`, `X.5`.
  const text = gcode
    .replace(/\n$/, "")
    .split("\n")
    .map((line, i) =>
      blocks.some(({ first, last }) => first <= i + 1 && i + 1 <= last) ? tidy(line) : line,
    );
  let lines: GcodeLine[];
  let stop: PostWarning | null = null;
  try {
    lines = parseGcode(text.join("\n"));
  } catch (error) {
    const line = Number(/line (\d+)/.exec((error as Error).message)?.[1]);
    lines = parseGcode(text.slice(0, line - 1).join("\n"));
    stop = warning(line, "unreadable");
  }
  const unfollowed = lines.find(({ words }) =>
    words.some(({ letter, value }) => letter === "G" && UNFOLLOWED.has(Math.floor(value))),
  );
  if (unfollowed) {
    lines = lines.slice(0, unfollowed.number - 1);
    stop = warning(unfollowed.number, "unfollowed");
  }

  const tools = projectTools(project);
  const material = new Material(project, [...tools.values()]);
  const bottom = stockBounds(project.stock).min[2];
  const toolAt = (comment: string | null) =>
    comment?.startsWith("Tool: ") ? tools.get(comment.slice(6)) : undefined;
  // The program-start block runs with the first tool loaded, before its comment.
  const first = lines.map(({ comment }) => toolAt(comment)).find((known) => known !== undefined);
  let tool: CutterProfile | null = first ? cutterProfile(first) : null;
  /** The next tool, named before the tool change that loads it. */
  let next: Tool | undefined;
  const moves = new Map(gcodeMoves(lines).map((move) => [move.line, move]));
  const warnings: (PostWarning | null)[] = [];
  for (const line of lines) {
    next = toolAt(line.comment) ?? next;
    const move = moves.get(line.number);
    const block = blockAt(line.number);
    const own = block === undefined || line.number > block.last;
    // The new bit goes in at the pause (or `M6`) for it; with neither, before its first cut.
    const changes = line.words.some(
      ({ letter, value }) => letter === "M" && (value === 0 || value === 1 || value === 6),
    );
    if (next && (changes || (own && move?.kind === "feed"))) {
      tool = cutterProfile(next);
      next = undefined;
    }
    if (!move) continue;
    if (own && move.kind === "feed") {
      // The program's own cut, which may go through the stock into the bed on purpose.
      if (tool !== null && !move.from.some(Number.isNaN)) material.cut(tool, move.from, move.to);
      continue;
    }
    if (move.to[2] < bottom - EPSILON) {
      warnings.push(warning(line.number, "belowBottom", move.to[2]));
    }
    const depth = material.pass(tool, move);
    if (Number.isNaN(depth)) {
      warnings.push(warning(line.number, "unknownPosition"));
    } else if (depth > MATERIAL_TOLERANCE) {
      warnings.push(warning(line.number, "material", round(depth)));
    }
  }
  return [...warnings, stop].filter((warning) => warning !== null);
}

/** A hand-written block as `parseGcode` reads them, or unchanged if it isn't G-code. */
function tidy(line: string): string {
  const code = line.replace(/\([^)]*\)|;.*$/g, " ").toUpperCase();
  if (code.replace(LOOSE_WORD, "").trim() !== "") return line;
  return [...code.matchAll(LOOSE_WORD)]
    .map(([, letter, value]) => `${letter}${Number(value)}`)
    .join(" ");
}

/** The project's tools by the label `grbl` writes in its `Tool:` comments. */
export function projectTools({ operations }: CheckedProject): Map<string, Tool> {
  const tools = new Map<string, Tool>();
  for (const operation of operations) {
    for (const tool of [operation.tool, clearingTool(operation)]) {
      if (tool) tools.set(`${tool.name}, ${formatNumber(tool.diameter)} mm`, tool);
    }
  }
  return tools;
}

/**
 * The stock left so far, as a heightmap in stock coordinates (ADR-0019) on
 * a grid fine enough for the project's narrowest tool. Moves come in work
 * coordinates.
 */
export class Material {
  private readonly grid: HeightmapGrid;
  private readonly heights: Float32Array;
  private readonly offset: Vec3;
  private readonly top: number;
  private readonly segment = new Float32Array(6);

  constructor({ stock }: CheckedProject, tools: Tool[]) {
    const narrowest = Math.min(...tools.map((tool) => tool.diameter));
    this.grid = heightmapGrid(stock, Number.isFinite(narrowest) ? narrowest : 1, 2_000_000);
    this.heights = new Float32Array(this.grid.columns * this.grid.rows);
    this.offset = stockOffset(stock);
    this.top = stockBounds(stock).max[2];
  }

  cut(tool: CutterProfile, from: Vec3, to: Vec3) {
    this.segment.set([...this.toStock(from), ...this.toStock(to)]);
    sweepMoves(this.grid, this.heights, tool, this.segment, 0, 1);
  }

  /**
   * How deep into the material left `move` passes with `tool` at its deepest,
   * cutting away what it passes through: `0` (or less) if it clears it
   * everywhere, `NaN` if it goes below the stock top from an unknown position
   * or with no tool.
   */
  pass(tool: CutterProfile | null, { from, to }: GcodeMove): number {
    // A move up out of a cut can still cross material on its way.
    const lowest = Number.isNaN(from[2]) ? to[2] : Math.min(from[2], to[2]);
    if (!(lowest < this.top - EPSILON)) return 0;
    if (tool === null || from.some(Number.isNaN) || to.some(Number.isNaN)) return Number.NaN;
    const depth = this.collision(tool, from, to);
    // What it went through is gone, so backing out of it is no second fault.
    this.cut(tool, from, to);
    return depth;
  }

  /**
   * How deep into the material left `tool` passes moving from `from` to `to`
   * at its deepest, `0` (or less) if it clears it everywhere.
   */
  collision(tool: CutterProfile, from: Vec3, to: Vec3): number {
    const a = this.toStock(from);
    const b = this.toStock(to);
    const { columns, rows, cellWidth, cellHeight } = this.grid;
    const step = Math.min(cellWidth, cellHeight) / 2;
    const samples = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    let deepest = -Infinity;
    for (let i = 0; i <= samples; i++) {
      const t = i / samples;
      const x = a[0] + (b[0] - a[0]) * t;
      const y = a[1] + (b[1] - a[1]) * t;
      const z = a[2] + (b[2] - a[2]) * t;
      // Nothing is ever higher than the stock top.
      if (z >= 0) continue;
      const first = Math.max(0, Math.floor((x - tool.radius) / cellWidth));
      const last = Math.min(columns - 1, Math.floor((x + tool.radius) / cellWidth));
      const firstRow = Math.max(0, Math.floor((y - tool.radius) / cellHeight));
      const lastRow = Math.min(rows - 1, Math.floor((y + tool.radius) / cellHeight));
      for (let row = firstRow; row <= lastRow; row++) {
        for (let column = first; column <= last; column++) {
          const dx = (column + 0.5) * cellWidth - x;
          const dy = (row + 0.5) * cellHeight - y;
          const distance = Math.hypot(dx, dy);
          if (distance > tool.radius) continue;
          const height = this.heights[row * columns + column] as number;
          deepest = Math.max(deepest, height - (z + tool.height(distance)));
        }
      }
    }
    return deepest;
  }

  /** The height of the stock left at `[x, y]` in work coordinates, or `null` off the stock. */
  height(x: number, y: number): number | null {
    const [sx, sy] = this.toStock([x, y, 0]);
    const { columns, rows, cellWidth, cellHeight } = this.grid;
    const column = Math.floor(sx / cellWidth);
    const row = Math.floor(sy / cellHeight);
    if (column < 0 || row < 0 || column >= columns || row >= rows) return null;
    return (this.heights[row * columns + column] as number) + this.offset[2];
  }

  private toStock([x, y, z]: Vec3): Vec3 {
    return [x - this.offset[0], y - this.offset[1], z - this.offset[2]];
  }
}

export function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
