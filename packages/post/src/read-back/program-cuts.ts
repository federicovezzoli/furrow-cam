// Reads a posted program back as the cuts the simulator plays (ADR-0096):
// the GRBL 1.1 and Marlin our posts write, and what hand-written custom
// blocks typically add to them.
import {
  type CutterShape,
  DEFAULT_CHORD_TOLERANCE,
  type SimulationCut,
  stockOffset,
  type Vec3,
} from "@furrow/cam-core";
import { type Stock, ToolType } from "@furrow/document";
import { type GcodeLine, parseGcodeLine, tidy } from "./read-back";

/** A word the simulation skips, or one after which it can't tell where the tool is. */
export type ProgramWarning = {
  /** 1-based, as editors number lines. */
  line: number;
  /**
   * `unsupported`: the word is skipped. `unknownPosition`: the axes it moves
   * are unknown until the program sets them again, and nothing is cut
   * meanwhile.
   */
  code: "unsupported" | "unknownPosition";
  /** The word as read, e.g. `G53` or `A10`. */
  word: string;
};

/** Why a program can't be simulated past line `line`. */
export type ProgramReadReason =
  /** Text that isn't G-code. */
  | "unreadable"
  /** A feed (`G1`–`G3`) from a position that isn't known. */
  | "unknownStart"
  /** A move before any `(Furrow tool: …)` comment. */
  | "noTool"
  /** A `(Furrow tool: …)` comment that doesn't give a cutter. */
  | "badTool"
  /** An arc whose centre isn't given, or whose radius can't reach its end point. */
  | "badArc"
  /** Axis words without a motion mode. */
  | "noMotion";

export class ProgramReadError extends Error {
  constructor(
    readonly line: number,
    readonly reason: ProgramReadReason,
  ) {
    super(`line ${line}: ${reason}`);
    this.name = "ProgramReadError";
  }
}

/** Where an operation starts, by its `(Operation: …)` comment. */
export type ProgramPart = { name: string; line: number; cut: number; segment: number };

export type ProgramCuts = {
  /** One per `(Furrow tool: …)` comment, rapids included (ADR-0019), in stock coordinates. */
  cuts: SimulationCut[];
  /** `lines[i][j]`: the line segment `j` of cut `i` comes from. */
  lines: Uint32Array[];
  parts: ProgramPart[];
  warnings: ProgramWarning[];
};

const TOOL_COMMENT = "Furrow tool:";
const OPERATION_COMMENT = "Operation: ";

/** Modal and non-modal codes that change nothing the simulation follows. */
const IGNORED_G = new Set([4, 40, 49, 54, 61, 61.1, 64, 80, 91.1, 93, 94, 28.1, 30.1]);
/** Codes after which no axis is known: stored positions, probing, offsets, other work systems. */
const UNKNOWN_AFTER = new Set([
  28, 30, 38.2, 38.3, 38.4, 38.5, 43, 43.1, 92, 92.1, 55, 56, 57, 58, 59,
]);
const KNOWN_M = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 30, 117, 400]);
// `H` only names an offset for `G43`, which loses the position anyway.
const IGNORED_LETTERS = new Set(["F", "S", "T", "N", "P", "H"]);
const AXES = "XYZ";
const MM_PER_INCH = 25.4;
/** GRBL's arc tolerances: the end point's radius may differ from the start's by this much. */
const ARC_RADIUS_ERROR = 0.005;
const ARC_RADIUS_RELATIVE_ERROR = 0.001;
/** More chords than any real arc needs: a 1 m circle takes about 700. */
const MAX_ARC_CHORDS = 100_000;
/** The arc's two axes and its linear one, by plane, in GRBL's order. */
const PLANES: Record<17 | 18 | 19, [number, number, number]> = {
  17: [0, 1, 2],
  18: [2, 0, 1],
  19: [1, 2, 0],
};

/**
 * The cuts of `gcode`, posted for `stock`, as ADR-0096 reads it: each move
 * swept with the cutter of the last `(Furrow tool: …)` comment before it,
 * arcs split into chords. Hand-written lines are read as GRBL would
 * (`g0z5`, `X.5`). After `G53` the axes it names are unknown, after `G28`,
 * probing or an offset all of them are; nothing is cut until a rapid makes
 * them known again, which is swept as coming straight down from above the
 * stock top. Throws a `ProgramReadError` where the program can't be
 * followed.
 */
export function programCuts(gcode: string, stock: Stock): ProgramCuts {
  const offset = stockOffset(stock);
  // Work coordinates of the stock top.
  const top = offset[2];
  const cuts: SimulationCut[] = [];
  const lines: Uint32Array[] = [];
  const parts: ProgramPart[] = [];
  const warnings: ProgramWarning[] = [];
  let cut: { tool: CutterShape; segments: number[]; lines: number[] } | null = null;
  const finish = () => {
    if (!cut) return;
    cuts.push({ tool: cut.tool, segments: new Float32Array(cut.segments) });
    lines.push(Uint32Array.from(cut.lines));
  };
  const segment = (line: number, from: Vec3, to: Vec3) => {
    if (!cut) throw new ProgramReadError(line, "noTool");
    for (const [i, value] of [...from, ...to].entries()) {
      cut.segments.push(value - (offset[i % 3] as number));
    }
    cut.lines.push(line);
  };

  let position: Vec3 = [Number.NaN, Number.NaN, Number.NaN];
  let motion: 0 | 1 | 2 | 3 | null = null;
  let relative = false;
  let scale = 1;
  let plane: 17 | 18 | 19 = 17;
  const texts = gcode.replace(/\n$/, "").split("\n");
  for (const [i, text] of texts.entries()) {
    const number = i + 1;
    const line = readLine(text, number);
    const comment = line.comment;
    if (comment?.startsWith(TOOL_COMMENT)) {
      finish();
      cut = { tool: readTool(comment, number), segments: [], lines: [] };
    } else if (comment?.startsWith(OPERATION_COMMENT)) {
      const index = Math.max(0, cuts.length + (cut ? 0 : -1));
      const at = cut ? cut.lines.length : 0;
      parts.push({
        name: comment.slice(OPERATION_COMMENT.length),
        line: number,
        cut: index,
        segment: at,
      });
    }

    const axes: (number | undefined)[] = [undefined, undefined, undefined];
    const arc: Record<"I" | "J" | "K" | "R", number | undefined> = {
      I: undefined,
      J: undefined,
      K: undefined,
      R: undefined,
    };
    let machine = false;
    let lost = false;
    for (const { letter, value } of line.words) {
      const word = `${letter}${value}`;
      if (letter === "G") {
        if (value === 0 || value === 1 || value === 2 || value === 3) motion = value;
        else if (value === 17 || value === 18 || value === 19) plane = value;
        else if (value === 20) scale = MM_PER_INCH;
        else if (value === 21) scale = 1;
        else if (value === 90) relative = false;
        else if (value === 91) relative = true;
        else if (value === 80) motion = null;
        else if (value === 53) {
          machine = true;
          warnings.push({ line: number, code: "unknownPosition", word });
        } else if (UNKNOWN_AFTER.has(value)) {
          lost = true;
          warnings.push({ line: number, code: "unknownPosition", word });
        } else if (!IGNORED_G.has(value))
          warnings.push({ line: number, code: "unsupported", word });
      } else if (letter === "M") {
        if (!KNOWN_M.has(value)) warnings.push({ line: number, code: "unsupported", word });
      } else if (AXES.includes(letter)) axes[AXES.indexOf(letter)] = value;
      else if (letter === "I" || letter === "J" || letter === "K" || letter === "R") {
        arc[letter] = value;
      } else if (!IGNORED_LETTERS.has(letter)) {
        warnings.push({ line: number, code: "unsupported", word });
      }
    }

    if (lost) {
      position = [Number.NaN, Number.NaN, Number.NaN];
      continue;
    }
    const noAxes = axes.every((value) => value === undefined);
    const arcWords = [arc.I, arc.J, arc.K, arc.R].some((value) => value !== undefined);
    // GRBL refuses an arc without axis words; Marlin cuts a full circle about its centre.
    if (noAxes && arcWords && (motion === 2 || motion === 3)) {
      warnings.push({ line: number, code: "unsupported", word: `G${motion}` });
    }
    const circle =
      (motion === 2 || motion === 3) && [arc.I, arc.J, arc.K].some((v) => v !== undefined);
    if (noAxes && !circle) continue;
    if (machine) {
      // Where machine coordinates are in work coordinates isn't known.
      position = position.map((value, axis) =>
        axes[axis] === undefined ? value : Number.NaN,
      ) as Vec3;
      continue;
    }
    if (motion === null) throw new ProgramReadError(number, "noMotion");
    const from = position;
    const to = from.map((value, axis) => {
      const word = axes[axis];
      if (word === undefined) return value;
      return relative ? value + word * scale : word * scale;
    }) as Vec3;
    position = to;
    const known = (point: Vec3) => point.every(Number.isFinite);
    if (!known(from)) {
      if (motion !== 0) throw new ProgramReadError(number, "unknownStart");
      if (known(to)) segment(number, [to[0], to[1], Math.max(to[2], top)], to);
      continue;
    }
    if (motion === 0 || motion === 1) {
      segment(number, from, to);
      continue;
    }
    const centre = { I: arc.I, J: arc.J, K: arc.K, R: arc.R };
    for (const key of ["I", "J", "K", "R"] as const) {
      if (centre[key] !== undefined) centre[key] = (centre[key] as number) * scale;
    }
    let previous = from;
    for (const point of arcPoints(from, to, motion === 2, PLANES[plane], centre, number)) {
      segment(number, previous, point);
      previous = point;
    }
  }
  finish();
  return { cuts, lines, parts, warnings };
}

/** Line `number`, hand-written words tidied as GRBL reads them. */
function readLine(text: string, number: number): GcodeLine {
  try {
    return parseGcodeLine(text, number);
  } catch {
    const tidied = tidy(text);
    if (tidied !== text) {
      try {
        return parseGcodeLine(tidied, number);
      } catch {}
    }
    throw new ProgramReadError(number, "unreadable");
  }
}

/** The cutter a `(Furrow tool: type=v_bit diameter=12 vAngle=60 …)` comment gives. */
function readTool(comment: string, line: number): CutterShape {
  const fields = new Map(
    comment
      .slice(TOOL_COMMENT.length)
      .trim()
      .split(/\s+/)
      .map((field) => field.split("=") as [string, string | undefined]),
  );
  const type = ToolType.safeParse(fields.get("type"));
  const length = (key: string) => {
    const text = fields.get(key);
    if (text === undefined) return null;
    const value = Number(text);
    if (text === "" || !Number.isFinite(value)) throw new ProgramReadError(line, "badTool");
    return value;
  };
  const diameter = length("diameter");
  const vAngle = length("vAngle");
  const tipDiameter = length("tipDiameter");
  const taperAngle = length("taperAngle");
  // What `cutterProfile` needs of each type, in the document's ranges.
  const valid =
    type.success &&
    diameter !== null &&
    diameter > 0 &&
    (tipDiameter === null || tipDiameter >= 0) &&
    (type.data !== "v_bit" || (vAngle !== null && vAngle > 0 && vAngle < 180)) &&
    (type.data !== "tapered_ball_end_mill" ||
      (tipDiameter !== null &&
        tipDiameter > 0 &&
        taperAngle !== null &&
        taperAngle > 0 &&
        taperAngle < 90));
  if (!valid) throw new ProgramReadError(line, "badTool");
  return { type: type.data, diameter, vAngle, tipDiameter, taperAngle };
}

/**
 * The chords of an arc from `from` to `to`, within the chord tolerance, as
 * GRBL cuts it: `I J K` are offsets from `from` to the centre; with `R` the
 * centre is on the shorter arc, the longer for a negative `R`. A helix rises
 * evenly along the plane's linear axis. Ends exactly at `to`.
 */
function arcPoints(
  from: Vec3,
  to: Vec3,
  clockwise: boolean,
  [a, b, linear]: [number, number, number],
  centre: Record<"I" | "J" | "K" | "R", number | undefined>,
  line: number,
): Vec3[] {
  const letters = "IJK";
  const dx = (to[a] as number) - (from[a] as number);
  const dy = (to[b] as number) - (from[b] as number);
  let ca: number;
  let cb: number;
  if (centre.R !== undefined) {
    let r = centre.R;
    const squared = 4 * r * r - dx * dx - dy * dy;
    const chord = Math.hypot(dx, dy);
    if (squared < 0 || chord === 0) throw new ProgramReadError(line, "badArc");
    let h = -Math.sqrt(squared) / chord;
    if (!clockwise) h = -h;
    if (r < 0) {
      h = -h;
      r = -r;
    }
    ca = 0.5 * (dx - dy * h);
    cb = 0.5 * (dy + dx * h);
  } else {
    const oa = centre[letters[a] as "I" | "J" | "K"];
    const ob = centre[letters[b] as "I" | "J" | "K"];
    if (oa === undefined && ob === undefined) throw new ProgramReadError(line, "badArc");
    ca = oa ?? 0;
    cb = ob ?? 0;
  }
  // From the centre to the start and to the end.
  const sa = -ca;
  const sb = -cb;
  const ea = dx - ca;
  const eb = dy - cb;
  const radius = Math.hypot(sa, sb);
  const error = Math.abs(Math.hypot(ea, eb) - radius);
  if (radius === 0 || (error > ARC_RADIUS_ERROR && error > ARC_RADIUS_RELATIVE_ERROR * radius)) {
    throw new ProgramReadError(line, "badArc");
  }
  let sweep = Math.atan2(sa * eb - sb * ea, sa * ea + sb * eb);
  const EPSILON = 5e-7;
  if (clockwise) {
    if (sweep >= -EPSILON) sweep -= 2 * Math.PI;
  } else if (sweep <= EPSILON) sweep += 2 * Math.PI;
  const step =
    radius > DEFAULT_CHORD_TOLERANCE
      ? 2 * Math.acos(1 - DEFAULT_CHORD_TOLERANCE / radius)
      : Math.PI;
  const count = Math.max(1, Math.ceil(Math.abs(sweep) / step));
  // A huge radius rounds the step to nothing.
  if (!(count <= MAX_ARC_CHORDS)) throw new ProgramReadError(line, "badArc");
  const start = Math.atan2(sb, sa);
  const rise = (to[linear] as number) - (from[linear] as number);
  const points: Vec3[] = [];
  for (let i = 1; i < count; i++) {
    const angle = start + (sweep * i) / count;
    const point: Vec3 = [0, 0, 0];
    point[a] = (from[a] as number) + ca + radius * Math.cos(angle);
    point[b] = (from[b] as number) + cb + radius * Math.sin(angle);
    point[linear] = (from[linear] as number) + (rise * i) / count;
    points.push(point);
  }
  points.push(to);
  return points;
}
