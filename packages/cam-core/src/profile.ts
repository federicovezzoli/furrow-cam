import { distance, type Point, type ProfileOperation, type Shape } from "@furrow/document";
import { DEFAULT_CHORD_TOLERANCE, flattenPath } from "./flatten";
import { offset, type Polygon, signedArea } from "./geometry";
import { type Toolpath, ToolpathBuilder } from "./toolpath";

export type ProfileOptions = {
  /** Retract height above the stock top. */
  safeZ: number;
  /** Chord tolerance for curves and offsets, in millimetres. */
  tolerance?: number;
};

/** Height above the stock top where rapids down stop and feeding starts. */
export const ENTRY_CLEARANCE = 1;

/** A closed ring the tool follows, in cutting direction, without its closing point. */
type Contour = { ring: Point[]; wasteLeft: boolean };

/** Everything the passes of one profile share. */
type Cut = {
  builder: ToolpathBuilder;
  feedRate: number;
  plungeRate: number;
  /** Horizontal travel per millimetre of descent when ramping, or `null` to plunge. */
  rampRun: number | null;
  /** Ramps along anything shorter than this plunge instead. */
  minRampLength: number;
  leadInRadius: number | null;
  tolerance: number;
};

/**
 * The toolpath of a profile operation (PRD-0001 R5), in stock coordinates.
 *
 * - `outside` keeps the area enclosed by the closed paths of all `shapes` and
 *   `inside` removes it, with nested rings toggling inside and outside (even-odd),
 *   so a part with holes is profiled outside its outline and inside its holes.
 *   `on` follows each path as drawn, open paths included.
 * - Each contour is cut to `depth` in equal passes no deeper than the tool's
 *   step-down, all passes of a contour before the next; smaller contours first,
 *   so inner cuts come before the outline that frees the part.
 * - Climb milling keeps the material on the tool's right (clockwise spindle).
 * - The depth passes stay `allowance` away from the contour; a finish pass then
 *   cuts the exact contour at full depth, entering from the cleared slot.
 * - Each pass enters by ramping at the tool's plunge angle (along the contour,
 *   or back and forth on the lead-in arc or an open path) or plunges straight
 *   down when ramping is off, the angle is 90° or the path is too short.
 */
export function profileToolpath(
  operation: ProfileOperation,
  shapes: Shape[],
  options: ProfileOptions,
): Toolpath {
  const { tool, params } = operation;
  const tolerance = options.tolerance ?? DEFAULT_CHORD_TOLERANCE;
  const radius = tool.diameter / 2;
  const warnings: string[] = [];

  const closed: Polygon[] = [];
  const open: Point[][] = [];
  let points = 0;
  for (const shape of shapes) {
    for (const path of shape.paths) {
      if (path.segments.length === 0) points++;
      else if (path.closed) closed.push(flattenPath(path, tolerance).slice(0, -1));
      else open.push(flattenPath(path, tolerance));
    }
  }
  if (points > 0) warnings.push(`Skipped ${plural(points, "point")}: drill them instead.`);
  if (open.length > 0 && params.side !== "on") {
    warnings.push(
      `Skipped ${plural(open.length, "open path")}: inside and outside profiles need closed paths.`,
    );
  }
  if (params.depth > tool.fluteLength) warnings.push("The depth exceeds the tool's flute length.");

  const cut: Cut = {
    builder: new ToolpathBuilder(options.safeZ),
    feedRate: tool.feedRate,
    plungeRate: tool.plungeRate,
    rampRun:
      params.ramp && tool.plungeAngle < 90
        ? 1 / Math.tan((tool.plungeAngle * Math.PI) / 180)
        : null,
    minRampLength: radius,
    leadInRadius: params.leadIn?.radius ?? null,
    tolerance,
  };
  const levels = depthLevels(params.depth, tool.stepDown);

  const roughing = contours(closed, operation, radius + params.allowance);
  const finishing = params.finishPass ? contours(closed, operation, radius) : [];
  if (closed.length > 0 && roughing.length === 0 && finishing.length === 0) {
    warnings.push("The closed paths are too small for the tool.");
  }

  for (const contour of roughing) cutContour(cut, contour, levels);
  if (params.side === "on") for (const path of open) cutOpenPath(cut, path, levels);
  for (const contour of finishing) {
    if (!finishContour(cut, contour, roughing, params.allowance, -params.depth)) {
      cutContour(cut, contour, levels);
    }
  }
  cut.builder.retract();
  return { moves: cut.builder.moves, warnings };
}

/** Pass depths, as negative z: `depth` split into equal steps no deeper than `stepDown`. */
export function depthLevels(depth: number, stepDown: number): number[] {
  const count = Math.max(1, Math.ceil(depth / stepDown - 1e-9));
  return Array.from({ length: count }, (_, i) => (-depth * (i + 1)) / count);
}

/**
 * The rings the tool centre follows, `distance` away from the closed paths on
 * the operation's side, in cutting direction and cutting order.
 */
function contours(closed: Polygon[], operation: ProfileOperation, distance: number): Contour[] {
  const { side, direction } = operation.params;
  // Every ring here has the area it bounds on its left: the kept material for
  // `outside` and `on`, the waste for `inside`.
  const rings =
    side === "on"
      ? closed.map((ring) => (signedArea(ring) < 0 ? [...ring].reverse() : ring))
      : offset(closed, side === "outside" ? distance : -distance, { fillRule: "evenOdd" });
  const reverse = (direction === "climb") === (side !== "inside");
  return rings
    .filter((ring) => ring.length >= 2)
    .sort((a, b) => Math.abs(signedArea(a)) - Math.abs(signedArea(b)))
    .map((ring) => ({
      ring: startOnLongestEdge(reverse ? [...ring].reverse() : ring),
      wasteLeft: (side === "inside") !== reverse,
    }));
}

/** Starts the ring halfway along its longest edge, so a lead-in meets it on a straight. */
function startOnLongestEdge(ring: Point[]): Point[] {
  let longest = 0;
  let best = -1;
  ring.forEach((point, i) => {
    const length = distance(point, ring[(i + 1) % ring.length] as Point);
    if (length > longest) {
      longest = length;
      best = i;
    }
  });
  if (best < 0) return ring;
  const a = ring[best] as Point;
  const b = ring[(best + 1) % ring.length] as Point;
  const middle: Point = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  return [middle, ...ring.slice(best + 1), ...ring.slice(0, best + 1)];
}

/** Cuts a closed contour pass by pass, from the stock top down to each level. */
function cutContour(cut: Cut, contour: Contour, levels: number[]) {
  const loop = [...contour.ring, contour.ring[0] as Point];
  const track = new Track(loop);
  if (track.length <= cut.tolerance) return;
  const { builder } = cut;

  if (cut.leadInRadius !== null) {
    const arc = leadInArc(loop, cut.leadInRadius, contour.wasteLeft, cut.tolerance);
    const back = [...arc].reverse();
    enter(cut, arc[0] as Point);
    let z = 0;
    for (const level of levels) {
      descend(cut, arc, z, level);
      feedAlong(cut, arc, level);
      feedAlong(cut, loop, level);
      feedAlong(cut, back, level);
      z = level;
    }
    return;
  }

  enter(cut, loop[0] as Point);
  let at = 0;
  let z = 0;
  for (const level of levels) {
    if (cut.rampRun !== null && track.length >= cut.minRampLength) {
      // Spiral down along the contour, then cut a full lap from where the ramp ended.
      const run = (z - level) * cut.rampRun;
      for (const [point, travelled] of track.walk(at, run)) {
        builder.feed([point[0], point[1], rampZ(z, level, travelled, run)], cut.plungeRate);
      }
      at = (at + run) % track.length;
    } else {
      const point = track.pointAt(at);
      builder.feed([point[0], point[1], level], cut.plungeRate);
    }
    for (const [point] of track.walk(at, track.length)) {
      builder.feed([point[0], point[1], level], cut.feedRate);
    }
    z = level;
  }
}

/** Cuts an open path pass by pass, alternating direction so each pass starts where the last ended. */
function cutOpenPath(cut: Cut, path: Point[], levels: number[]) {
  const forward = path;
  const backward = [...path].reverse();
  if (new Track(path).length <= cut.tolerance) return;
  enter(cut, path[0] as Point);
  let z = 0;
  levels.forEach((level, i) => {
    const pass = i % 2 === 0 ? forward : backward;
    descend(cut, pass, z, level);
    feedAlong(cut, pass, level);
    z = level;
  });
}

/**
 * Cuts the finish lap of `contour` at full depth: down through the slot the
 * depth passes cleared, across to the contour, around it and back. Returns
 * `false` when no roughing ring is near enough to enter from.
 */
function finishContour(
  cut: Cut,
  contour: Contour,
  roughing: Contour[],
  allowance: number,
  depth: number,
): boolean {
  const entry = nearestPair(contour.ring, roughing, allowance + 2 * cut.tolerance + 1e-3);
  if (!entry) return false;
  const { builder } = cut;
  const [index, slot] = entry;
  const ring = [...contour.ring.slice(index), ...contour.ring.slice(0, index)];
  const start = ring[0] as Point;
  enter(cut, slot);
  builder.feed([slot[0], slot[1], depth], cut.plungeRate);
  builder.feed([start[0], start[1], depth], cut.feedRate);
  feedAlong(cut, [...ring, start], depth);
  builder.feed([slot[0], slot[1], depth], cut.feedRate);
  return true;
}

/**
 * The vertex of `ring` closest to a vertex of any of `others`, as its index
 * and the other vertex, if one is within `within`.
 */
function nearestPair(ring: Point[], others: Contour[], within: number): [number, Point] | null {
  const box = bounds(ring);
  let best: [number, Point] | null = null;
  let bestDistance = within;
  for (const other of others) {
    const otherBox = bounds(other.ring);
    if (
      otherBox.minX > box.maxX + within ||
      otherBox.maxX < box.minX - within ||
      otherBox.minY > box.maxY + within ||
      otherBox.maxY < box.minY - within
    ) {
      continue;
    }
    ring.forEach((point, i) => {
      for (const candidate of other.ring) {
        const d = distance(point, candidate);
        if (d <= bestDistance) {
          bestDistance = d;
          best = [i, candidate];
        }
      }
    });
  }
  return best;
}

function bounds(ring: Point[]) {
  const xs = ring.map((p) => p[0]);
  const ys = ring.map((p) => p[1]);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

/**
 * A quarter circle of `radius` on the waste side, from its start to `loop[0]`,
 * tangent to the loop's first edge there.
 */
function leadInArc(loop: Point[], radius: number, wasteLeft: boolean, tolerance: number): Point[] {
  const start = loop[0] as Point;
  const next = loop[1] as Point;
  const length = distance(start, next);
  const t: Point = [(next[0] - start[0]) / length, (next[1] - start[1]) / length];
  const n: Point = wasteLeft ? [-t[1], t[0]] : [t[1], -t[0]];
  const center: Point = [start[0] + radius * n[0], start[1] + radius * n[1]];
  // A chord spanning angle θ deviates from the arc by r(1 − cos(θ/2)).
  const step = tolerance >= radius ? Math.PI / 2 : 2 * Math.acos(1 - tolerance / radius);
  const count = Math.max(1, Math.ceil(Math.PI / 2 / step));
  const arc: Point[] = [];
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI / 2) * (i / count);
    const [c, s] = [Math.cos(angle), Math.sin(angle)];
    arc.push([
      center[0] + radius * (-t[0] * c - n[0] * s),
      center[1] + radius * (-t[1] * c - n[1] * s),
    ]);
  }
  arc.push(start);
  return arc;
}

/** Travels above `point`, rapids down to just above the stock and feeds down to its top. */
function enter(cut: Cut, point: Point) {
  const { builder } = cut;
  builder.travel(point[0], point[1]);
  builder.rapid([point[0], point[1], Math.min(ENTRY_CLEARANCE, builder.safeZ)]);
  builder.feed([point[0], point[1], 0], cut.plungeRate);
}

/**
 * Gets from `z` down to `level` at `path[0]`: ramping back and forth along
 * `path` as many times as the plunge angle needs, or straight down.
 */
function descend(cut: Cut, path: Point[], z: number, level: number) {
  const start = path[0] as Point;
  const track = new Track(path);
  if (cut.rampRun === null || track.length < cut.minRampLength) {
    cut.builder.feed([start[0], start[1], level], cut.plungeRate);
    return;
  }
  const run = (z - level) * cut.rampRun;
  // Go no further along the path than one trip there and back needs.
  const reach = Math.min(track.length, run / 2);
  const there = [...track.walk(0, reach)].map(([point]) => point);
  const back = [...there].reverse().slice(1);
  back.push(start);
  const trips = Math.ceil(run / (2 * reach));
  const total = 2 * trips * reach;
  let travelled = 0;
  let previous = start;
  for (let i = 0; i < trips; i++) {
    for (const point of [...there, ...back]) {
      travelled += distance(previous, point);
      previous = point;
      cut.builder.feed([point[0], point[1], rampZ(z, level, travelled, total)], cut.plungeRate);
    }
  }
}

/** Height `travelled` along a ramp of length `total` from `z` to `level`, ending exactly on `level`. */
function rampZ(z: number, level: number, travelled: number, total: number): number {
  return travelled >= total - 1e-9 ? level : z + ((level - z) * travelled) / total;
}

/** Feeds along `path` at height `z`. */
function feedAlong(cut: Cut, path: Point[], z: number) {
  for (const point of path) cut.builder.feed([point[0], point[1], z], cut.feedRate);
}

/** A polyline measured by length; a closed one repeats its first point at the end. */
class Track {
  readonly length: number;
  private readonly cumulative: number[];

  constructor(private readonly points: Point[]) {
    this.cumulative = [0];
    for (let i = 1; i < points.length; i++) {
      const previous = this.cumulative[i - 1] as number;
      this.cumulative.push(previous + distance(points[i - 1] as Point, points[i] as Point));
    }
    this.length = this.cumulative.at(-1) ?? 0;
  }

  /** The point `at` millimetres from the start, wrapping around a closed track. */
  pointAt(at: number): Point {
    const d = ((at % this.length) + this.length) % this.length;
    let i = 1;
    while (i < this.points.length - 1 && (this.cumulative[i] as number) < d) i++;
    const a = this.points[i - 1] as Point;
    const b = this.points[i] as Point;
    const from = this.cumulative[i - 1] as number;
    const span = (this.cumulative[i] as number) - from;
    const f = span > 0 ? (d - from) / span : 0;
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
  }

  /**
   * The points met going `run` millimetres forward from `at`, each with the
   * distance travelled to it, ending exactly `run` along. Wraps around a closed
   * track; on an open one `at + run` must not pass the end.
   */
  *walk(at: number, run: number): Generator<[Point, number]> {
    const end = at + run;
    let lap = Math.floor(at / this.length) * this.length;
    while (lap < end) {
      for (let i = 1; i < this.points.length; i++) {
        const position = lap + (this.cumulative[i] as number);
        if (position >= end) break;
        if (position > at) yield [this.points[i] as Point, position - at];
      }
      lap += this.length;
    }
    yield [this.pointAt(end), run];
  }
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
