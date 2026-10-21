// The rules every GRBL program `grbl` writes must keep to be safe to run
// (#149), read back with `../read-back`. Test support for the corpus, not
// part of the package's API.
import { type CutterProfile, cutterProfile, stockBounds, type Vec3 } from "@furrow/cam-core";
import { machineSpinUpDelay } from "@furrow/document";
import {
  type CheckedProject,
  EPSILON,
  type GcodeLine,
  type GcodeMove,
  gcodeMoves,
  MATERIAL_TOLERANCE,
  Material,
  parseGcode,
  projectTools,
  round,
} from "../read-back";

export type { CheckedProject, GcodeMove };

export type Violation = { line: number; rule: string; message: string };

/** The commands `grbl` writes: the modes, moves, dwell, spindle, pause and end. */
const ALLOWED = new Set([
  "G0",
  "G1",
  "G4",
  "G17",
  "G21",
  "G90",
  "G91",
  "G94",
  "M0",
  "M3",
  "M5",
  "M30",
]);
const MODES = ["G21", "G90", "G94", "G17"] as const;

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

  const spinUpDelay = machineSpinUpDelay(machine);
  const modes = new Set<string>();
  let spindle = false;
  /** The last speed set, `null` for none. */
  let speed: number | null = null;
  /** The line of an `M3` that started the spindle or raised its speed, until a long enough dwell. */
  let spinningUp: number | null = null;
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
    /** A dwell in this block, which GRBL runs after its spindle change whatever the word order. */
    let dwell: number | undefined;
    for (const { letter, value } of commands) {
      const command = `${letter}${value}`;
      if (!ALLOWED.has(command))
        fail(line.number, "words", `${command} isn't a command grbl writes`);
      modes.add(command);
      if (command === "M3") {
        const s = line.words.find((word) => word.letter === "S")?.value ?? null;
        if (!spindle || (s !== null && (speed === null || s > speed))) spinningUp = line.number;
        spindle = true;
        if (s !== null) speed = s;
      } else if (command === "M5") {
        spindle = false;
        speed = null;
      } else if (command === "G4") {
        dwell = line.words.find((word) => word.letter === "P")?.value;
        if (dwell === undefined) fail(line.number, "words", "G4 without P");
      } else if (command === "M0") {
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
    if (dwell !== undefined && dwell >= spinUpDelay - EPSILON) spinningUp = null;
    const dwells = commands.some(({ letter, value }) => letter === "G" && value === 4);
    for (const { letter, value } of line.words) {
      if (!"GMXYZFS".includes(letter) && !(letter === "P" && dwells)) {
        fail(line.number, "words", `unexpected word ${letter}`);
      }
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
    if (spinningUp !== null && spinUpDelay > 0) {
      fail(
        line.number,
        "spin-up",
        `moves before the spindle started on line ${spinningUp} is up to speed`,
      );
      spinningUp = null;
    }
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
      const depth = material.pass(tool, move);
      if (Number.isNaN(depth)) {
        fail(line.number, "rapid", "rapid below the stock top from an unknown position");
      } else if (depth > MATERIAL_TOLERANCE) {
        fail(line.number, "rapid", `rapid through ${round(depth)} mm of material`);
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
