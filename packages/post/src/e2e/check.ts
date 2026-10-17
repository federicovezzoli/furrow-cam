// A reader for the GRBL programs `grbl` writes, and the rules every one of
// them must keep to be safe to run (#149). Test support for the corpus, not
// part of the package's API.
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
import { formatNumber } from "../grbl";

/** Distance below which two coordinates count as equal: the programs' last decimal. */
const EPSILON = 1e-3;

/**
 * How far into the material left a rapid may seem to pass before it counts:
 * the heightmap's cells see the stock a little higher than the toolpaths'
 * own grids do, on slopes.
 */
const MATERIAL_TOLERANCE = 0.05;

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

export type Violation = { line: number; rule: string; message: string };

/** What a program is checked against: the project it was posted from. */
export type CheckedProject = Pick<ProjectDocument, "stock" | "machine" | "operations">;

/** The commands `grbl` writes: the modes, moves, spindle, pause and end. */
const ALLOWED = new Set(["G0", "G1", "G17", "G21", "G90", "G91", "G94", "M0", "M3", "M5", "M30"]);
const MODES = ["G21", "G90", "G94", "G17"] as const;

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

/**
 * Every way `gcode`, posted from `project`, breaks the rules a program must
 * keep to be safe to run, empty when it keeps them all:
 *
 * - `words`: only the commands `grbl` writes, each word well formed.
 * - `modes`: millimetres, absolute coordinates, feed per minute and the XY
 *   plane are set before the first move.
 * - `work-area`: the program spans no more than the machine's travel.
 * - `stock-bottom`: no move goes below the stock's bottom, into the bed.
 * - `rapid`: no rapid passes through material, going down, across or back
 *   up. The feeds before it are replayed on a heightmap of the stock with
 *   each tool's shape, so a rapid may go below the stock top where they cut
 *   it away: back into a pecked hole, across what roughing cleared.
 * - `feed`: every cut has a feed rate, its XY and Z components within the
 *   machine's maxima.
 * - `spindle`: the spindle turns while the tool cuts, at a speed in the
 *   machine's range, or with no `S` for a manual spindle.
 * - `pause`: the program pauses only with the tool above the stock and,
 *   unless the spindle is manual, stopped.
 * - `tool-change`: a new tool (a `Tool:` comment, as `grbl` writes them)
 *   is one of the project's and, after the first, comes with a pause before
 *   it cuts.
 * - `end`: the spindle is off and the tool above the stock at `M30`, the
 *   last block.
 */
export function checkGcode(gcode: string, project: CheckedProject): Violation[] {
  const { stock, machine } = project;
  const violations: Violation[] = [];
  const fail = (line: number, rule: string, message: string) =>
    violations.push({ line, rule, message });

  let lines: GcodeLine[];
  try {
    lines = parseGcode(gcode);
  } catch (error) {
    const message = (error as Error).message;
    return [{ line: Number(/line (\d+)/.exec(message)?.[1] ?? 0), rule: "words", message }];
  }
  const top = stockBounds(stock).max[2];
  const bottom = stockBounds(stock).min[2];
  const manualSpindle = machine !== null && machine.spindleRpmMin === null;
  const moves = new Map(gcodeMoves(lines).map((move) => [move.line, move]));
  const tools = projectTools(project);
  const material = new Material(project, [...tools.values()]);

  const modes = new Set<string>();
  let spindle = false;
  let tool: CutterProfile | null = null;
  let toolCount = 0;
  let paused = true;
  let position: Vec3 = [Number.NaN, Number.NaN, Number.NaN];
  const low: Vec3 = [Infinity, Infinity, Infinity];
  const high: Vec3 = [-Infinity, -Infinity, -Infinity];
  let ended: number | null = null;

  for (const line of lines) {
    if (ended !== null && (line.words.length > 0 || line.comment !== null)) {
      fail(line.number, "end", "blocks after M30");
      ended = null;
    }
    const label = line.comment?.startsWith("Tool: ") ? line.comment.slice(6) : null;
    if (label !== null) {
      const known = tools.get(label);
      if (known) tool = cutterProfile(known);
      else fail(line.number, "tool-change", `"${label}" isn't one of the project's tools`);
      toolCount++;
      if (toolCount > 1) paused = false;
    }
    const commands = line.words.filter(({ letter }) => letter === "G" || letter === "M");
    for (const { letter, value } of commands) {
      const command = `${letter}${value}`;
      if (!ALLOWED.has(command))
        fail(line.number, "words", `${command} isn't a command grbl writes`);
      modes.add(command);
      if (command === "M3") spindle = true;
      else if (command === "M5") spindle = false;
      else if (command === "M0") {
        if (!(position[2] >= top - EPSILON)) {
          fail(line.number, "pause", "pauses with the tool in the stock");
        }
        if (spindle && !manualSpindle) fail(line.number, "pause", "pauses with the spindle on");
        paused = true;
      } else if (command === "M30") {
        if (spindle) fail(line.number, "end", "ends with the spindle on");
        if (!(position[2] >= top - EPSILON)) fail(line.number, "end", "ends in the stock");
        ended = line.number;
      }
    }
    for (const { letter, value } of line.words) {
      if (!"GMXYZFS".includes(letter)) fail(line.number, "words", `unexpected word ${letter}`);
      if (letter !== "S" || machine === null) continue;
      const { spindleRpmMin: min, spindleRpmMax: max } = machine;
      if (min === null || max === null) {
        fail(line.number, "spindle", "sets a speed for a manual spindle");
      } else if (value < min || value > max) {
        fail(line.number, "spindle", `S${value} is outside ${min}–${max} RPM`);
      }
    }
    if (
      commands.some(({ letter, value }) => letter === "M" && value === 3) &&
      machine !== null &&
      !manualSpindle &&
      !line.words.some(({ letter }) => letter === "S")
    ) {
      fail(line.number, "spindle", "starts the spindle with no speed");
    }

    const move = moves.get(line.number);
    if (!move) continue;
    const missing = MODES.filter((mode) => !modes.has(mode));
    if (missing.length > 0) fail(line.number, "modes", `moves before ${missing.join(" ")}`);
    const { from, to } = move;
    for (let axis = 0; axis < 3; axis++) {
      const value = to[axis] as number;
      if (Number.isNaN(value)) continue;
      low[axis] = Math.min(low[axis] as number, value);
      high[axis] = Math.max(high[axis] as number, value);
    }
    if (to[2] < bottom - EPSILON) {
      fail(line.number, "stock-bottom", `Z${to[2]} is below the stock bottom at Z${bottom}`);
    }
    const known = from.every((value) => !Number.isNaN(value)) && !to.some(Number.isNaN);
    if (move.kind === "rapid") {
      // A rapid up out of a cut can still cross material on its way.
      const lowest = Number.isNaN(from[2]) ? to[2] : Math.min(from[2], to[2]);
      if (lowest < top - EPSILON) {
        if (!known || tool === null) {
          fail(line.number, "rapid", "rapid below the stock top from an unknown position");
        } else {
          const depth = material.collision(tool, from, to);
          if (depth > MATERIAL_TOLERANCE) {
            fail(line.number, "rapid", `rapid through ${round(depth)} mm of material`);
          }
          // What it went through is gone, so backing out of it is no second fault.
          material.cut(tool, from, to);
        }
      }
    } else {
      if (!spindle) fail(line.number, "spindle", "cuts with the spindle off");
      if (!paused) fail(line.number, "tool-change", "cuts with a new tool before pausing");
      if (!known) fail(line.number, "feed", "cuts from an unknown position");
      else if (tool !== null) material.cut(tool, from, to);
      const feedRate = move.feedRate;
      if (feedRate === null || !(feedRate > 0)) {
        fail(line.number, "feed", "cuts with no feed rate");
      } else if (machine !== null && known) {
        const xy = Math.hypot(to[0] - from[0], to[1] - from[1]);
        const z = Math.abs(to[2] - from[2]);
        const length = Math.hypot(xy, z);
        // Feeds are rounded down to 3 decimals, coordinates rounded either way.
        const slack = 1 + 1e-3;
        if (length > 0 && (feedRate * xy) / length > machine.maxFeedXY * slack) {
          fail(
            line.number,
            "feed",
            `XY at ${round((feedRate * xy) / length)} mm/min, over ${machine.maxFeedXY}`,
          );
        }
        if (length > 0 && (feedRate * z) / length > machine.maxFeedZ * slack) {
          fail(
            line.number,
            "feed",
            `Z at ${round((feedRate * z) / length)} mm/min, over ${machine.maxFeedZ}`,
          );
        }
      }
    }
    position = to;
  }

  const last = lines.at(-1)?.number ?? 0;
  if (ended === null && !violations.some(({ rule }) => rule === "end")) {
    fail(last, "end", "doesn't end with M30");
  }
  if (machine !== null) {
    const travel = [machine.workAreaX, machine.workAreaY, machine.workAreaZ];
    for (let axis = 0; axis < 3; axis++) {
      const span = (high[axis] as number) - (low[axis] as number);
      if (span > (travel[axis] as number) + EPSILON) {
        fail(last, "work-area", `spans ${round(span)} mm in ${"XYZ"[axis]}, over ${travel[axis]}`);
      }
    }
  }
  return violations;
}

/** `checkGcode`'s violations, one per line, as an assertion message reads them. */
export function formatViolations(violations: Violation[]): string {
  return violations
    .map(({ line, rule, message }) => `line ${line}: ${rule}: ${message}`)
    .join("\n");
}

/** The project's tools by the label `grbl` writes in its `Tool:` comments. */
function projectTools({ operations }: CheckedProject): Map<string, Tool> {
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
class Material {
  private readonly grid: HeightmapGrid;
  private readonly heights: Float32Array;
  private readonly offset: Vec3;
  private readonly segment = new Float32Array(6);

  constructor({ stock }: CheckedProject, tools: Tool[]) {
    const narrowest = Math.min(...tools.map((tool) => tool.diameter));
    this.grid = heightmapGrid(stock, Number.isFinite(narrowest) ? narrowest : 1, 2_000_000);
    this.heights = new Float32Array(this.grid.columns * this.grid.rows);
    this.offset = stockOffset(stock);
  }

  cut(tool: CutterProfile, from: Vec3, to: Vec3) {
    this.segment.set([...this.toStock(from), ...this.toStock(to)]);
    sweepMoves(this.grid, this.heights, tool, this.segment, 0, 1);
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

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * The stock a program leaves: its feeds swept with each tool's shape over a
 * heightmap of the stock. `height` reads it at a point in work coordinates,
 * `null` off the stock.
 */
export function simulateGcode(
  gcode: string,
  project: CheckedProject,
): { height(x: number, y: number): number | null } {
  const tools = projectTools(project);
  const material = new Material(project, [...tools.values()]);
  let tool: CutterProfile | null = null;
  const lines = parseGcode(gcode);
  const moves = new Map(gcodeMoves(lines).map((move) => [move.line, move]));
  for (const line of lines) {
    const known = line.comment?.startsWith("Tool: ") ? tools.get(line.comment.slice(6)) : undefined;
    if (known) tool = cutterProfile(known);
    const move = moves.get(line.number);
    if (move?.kind === "feed" && tool !== null && !move.from.some(Number.isNaN)) {
      material.cut(tool, move.from, move.to);
    }
  }
  return material;
}

/** The moves of each operation of a program, by the name in its `Operation:` comment. */
export function operationMoves(gcode: string): Map<string, GcodeMove[]> {
  const lines = parseGcode(gcode);
  const starts = lines.flatMap(({ comment, number }) =>
    comment?.startsWith("Operation: ") ? [{ name: comment.slice(11), number }] : [],
  );
  const operations = new Map<string, GcodeMove[]>();
  for (const move of gcodeMoves(lines)) {
    const start = starts.findLast(({ number }) => number < move.line);
    if (!start) continue;
    const moves = operations.get(start.name) ?? [];
    moves.push(move);
    operations.set(start.name, moves);
  }
  return operations;
}
