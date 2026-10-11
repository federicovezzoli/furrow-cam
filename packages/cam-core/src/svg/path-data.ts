import type { Point } from "@furrow/document";
import { NUMBER_PATTERN } from "./number";

/** A line or cubic Bézier in SVG user units; arcs and quadratics are converted to cubics. */
export type RawSegment =
  | { kind: "line"; to: Point }
  | { kind: "cubic"; c1: Point; c2: Point; to: Point };

export type RawSubpath = { start: Point; segments: RawSegment[]; closed: boolean };

const NUMBER = new RegExp(String.raw`[\s,]*(${NUMBER_PATTERN})`, "y");
const FLAG = /[\s,]*([01])/y;
const COMMAND = /\s*([MmZzLlHhVvCcSsQqTtAa])/y;

const PARAMETER_COUNTS: Record<string, number> = {
  m: 2,
  l: 2,
  h: 1,
  v: 1,
  c: 6,
  s: 4,
  q: 4,
  t: 2,
  a: 7,
  z: 0,
};

/**
 * Parses SVG path data (`d`). As SVG does, it renders everything up to the
 * first error and ignores the rest, so the result is never `null`; `valid`
 * says whether the whole string was read.
 */
export function parsePathData(d: string): { subpaths: RawSubpath[]; valid: boolean } {
  const subpaths: RawSubpath[] = [];
  let subpath: RawSubpath | null = null;
  let current: Point = [0, 0];
  // Reflected control points for S and T.
  let lastCubicControl: Point | null = null;
  let lastQuadraticControl: Point | null = null;
  let index = 0;
  let command: string | null = null;

  function readNumber(): number | null {
    NUMBER.lastIndex = index;
    const match = NUMBER.exec(d);
    if (!match) return null;
    index = NUMBER.lastIndex;
    return Number(match[1]);
  }

  function readFlag(): number | null {
    FLAG.lastIndex = index;
    const match = FLAG.exec(d);
    if (!match) return null;
    index = FLAG.lastIndex;
    return Number(match[1]);
  }

  function push(segment: RawSegment) {
    if (!subpath) {
      subpath = { start: current, segments: [], closed: false };
      subpaths.push(subpath);
    }
    subpath.segments.push(segment);
    current = segment.to;
  }

  for (;;) {
    COMMAND.lastIndex = index;
    const match = COMMAND.exec(d);
    if (match) {
      command = match[1] as string;
      index = COMMAND.lastIndex;
    } else if (/^[\s,]*$/.test(d.slice(index))) {
      return { subpaths, valid: true };
    } else if (command === null || command === "z" || command === "Z") {
      // Data must start with a command, and Z takes no parameters to repeat.
      return { subpaths, valid: false };
    }
    // Otherwise the previous command repeats with new parameters.

    const lower: string = (command as string).toLowerCase();
    if (subpaths.length === 0 && lower !== "m") return { subpaths, valid: false };
    const relative: boolean = command !== lower.toUpperCase();
    const args: number[] = [];
    const count = PARAMETER_COUNTS[lower] as number;
    for (let i = 0; i < count; i++) {
      const value = lower === "a" && (i === 3 || i === 4) ? readFlag() : readNumber();
      if (value === null) return { subpaths, valid: false };
      args.push(value);
    }
    const [dx, dy] = relative ? current : [0, 0];
    const point = (i: number): Point => [(args[i] as number) + dx, (args[i + 1] as number) + dy];

    let cubicControl: Point | null = null;
    let quadraticControl: Point | null = null;
    switch (lower) {
      case "m":
        current = point(0);
        subpath = { start: current, segments: [], closed: false };
        subpaths.push(subpath);
        // Further coordinate pairs after a moveto are linetos.
        command = relative ? "l" : "L";
        break;
      case "z":
        if (subpath) {
          subpath.closed = true;
          current = subpath.start;
        }
        // The next segment, unless it's a moveto, starts a new subpath here.
        subpath = null;
        break;
      case "l":
        push({ kind: "line", to: point(0) });
        break;
      case "h":
        push({ kind: "line", to: [(args[0] as number) + dx, current[1]] });
        break;
      case "v":
        push({ kind: "line", to: [current[0], (args[0] as number) + dy] });
        break;
      case "c":
        cubicControl = point(2);
        push({ kind: "cubic", c1: point(0), c2: cubicControl, to: point(4) });
        break;
      case "s": {
        const c1 = reflect(lastCubicControl, current);
        cubicControl = point(0);
        push({ kind: "cubic", c1, c2: cubicControl, to: point(2) });
        break;
      }
      case "q":
        quadraticControl = point(0);
        push(quadraticToCubic(current, quadraticControl, point(2)));
        break;
      case "t":
        quadraticControl = reflect(lastQuadraticControl, current);
        push(quadraticToCubic(current, quadraticControl, point(0)));
        break;
      case "a": {
        const to = point(5);
        for (const segment of arcToCubics(
          current,
          args[0] as number,
          args[1] as number,
          args[2] as number,
          args[3] === 1,
          args[4] === 1,
          to,
        )) {
          push(segment);
        }
        break;
      }
    }
    lastCubicControl = cubicControl;
    lastQuadraticControl = quadraticControl;
  }
}

function reflect(control: Point | null, about: Point): Point {
  return control ? [2 * about[0] - control[0], 2 * about[1] - control[1]] : about;
}

function quadraticToCubic(p0: Point, q: Point, p3: Point): RawSegment {
  return {
    kind: "cubic",
    c1: [p0[0] + (2 / 3) * (q[0] - p0[0]), p0[1] + (2 / 3) * (q[1] - p0[1])],
    c2: [p3[0] + (2 / 3) * (q[0] - p3[0]), p3[1] + (2 / 3) * (q[1] - p3[1])],
    to: p3,
  };
}

/**
 * An elliptical arc as cubics of at most 90° each, following the SVG
 * implementation notes (endpoint to centre parameterization, radii scaled up
 * when too small). Ends on `to` exactly.
 */
export function arcToCubics(
  from: Point,
  rxIn: number,
  ryIn: number,
  rotationDegrees: number,
  largeArc: boolean,
  sweep: boolean,
  to: Point,
): RawSegment[] {
  if (from[0] === to[0] && from[1] === to[1]) return [];
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if (rx === 0 || ry === 0) return [{ kind: "line", to }];

  const phi = (rotationDegrees * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const hx = (from[0] - to[0]) / 2;
  const hy = (from[1] - to[1]) / 2;
  const x1 = cos * hx + sin * hy;
  const y1 = -sin * hx + cos * hy;

  const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const numerator = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const denominator = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  let factor = Math.sqrt(Math.max(0, numerator / denominator));
  if (largeArc === sweep) factor = -factor;
  const cx1 = (factor * rx * y1) / ry;
  const cy1 = (-factor * ry * x1) / rx;
  const cx = cos * cx1 - sin * cy1 + (from[0] + to[0]) / 2;
  const cy = sin * cx1 + cos * cy1 + (from[1] + to[1]) / 2;

  const angle = (ux: number, uy: number, vx: number, vy: number) =>
    Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const theta = angle(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
  let delta = angle((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  else if (sweep && delta < 0) delta += 2 * Math.PI;

  // A point on the ellipse at parameter t, and the derivative there.
  const at = (t: number): Point => [
    cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin,
    cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos,
  ];
  const derivative = (t: number): Point => [
    -rx * Math.sin(t) * cos - ry * Math.cos(t) * sin,
    -rx * Math.sin(t) * sin + ry * Math.cos(t) * cos,
  ];

  const count = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 2) - 1e-9));
  const step = delta / count;
  const k = (4 / 3) * Math.tan(step / 4);
  const segments: RawSegment[] = [];
  let start = from;
  for (let i = 0; i < count; i++) {
    const t0 = theta + i * step;
    const t1 = t0 + step;
    const end = i === count - 1 ? to : at(t1);
    const d0 = derivative(t0);
    const d1 = derivative(t1);
    segments.push({
      kind: "cubic",
      c1: [start[0] + k * d0[0], start[1] + k * d0[1]],
      c2: [end[0] - k * d1[0], end[1] - k * d1[1]],
      to: end,
    });
    start = end;
  }
  return segments;
}
