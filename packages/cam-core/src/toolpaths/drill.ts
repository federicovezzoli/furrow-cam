import {
  type DrillOperation,
  GEOMETRY_TOLERANCE,
  type Point,
  pointsCoincide,
  type Shape,
  type Tool,
} from "@furrow/document";
import { DRILL_DIAMETER_TOLERANCE, isRound, roundness } from "../geometry/circle";
import { arcStep } from "../geometry/flatten";
import type { ToolpathMessage } from "./messages";
import { depthLevels } from "./passes";
import { type Toolpath, ToolpathBuilder } from "./toolpath";

export type DrillOptions = {
  /** Retract height above the stock top. */
  safeZ: number;
  /** Height above the stock top where rapids down stop and feeding starts, capped at `safeZ`. */
  entryClearance: number;
};

/**
 * The toolpath of a drill operation (PRD-0001 R8), in stock coordinates.
 *
 * - Holes are at single-point paths and at the centre of each closed path
 *   a circle fits (`isRound`): its outline within `DRILL_DIAMETER_TOLERANCE`
 *   of one radius, or 1% of the radius for large circles. That takes in
 *   circles drawn as arcs, and circles exported as polygons or Béziers, with
 *   no guess at what is meant as a circle: a coarse polygon has no circle
 *   that fits it. The
 *   hole's size is the circle through its farthest points, so the hole
 *   contains the drawn outline. Other paths are skipped.
 * - A point, or a circle the tool fits within that tolerance, is drilled:
 *   without pecking the tool feeds straight to `depth` at its plunge rate;
 *   pecking splits the depth into equal pecks no deeper than the tool's
 *   step-down, and after each the tool rapids up to just above the stock to
 *   clear the chips, then back down to just above the bottom of the last.
 * - A larger circle is bored by an end mill: climb-milling helices down
 *   from just above the stock, no steeper than the tool's plunge angle and
 *   dropping no more than its step-down per turn, each ending with a full
 *   turn at depth; a circle over twice the tool diameter gets rings from the
 *   inside out, no further apart than the operation's step-over. A drill bit can't cut
 *   sideways, so it skips them; circles smaller than the tool are skipped too.
 * - Holes at the same centre are cut once, the largest. They start with the
 *   one nearest the stock's bottom-left corner and go each to the nearest
 *   one left, then 2-opt shortens the route.
 * - The tool rapids out of each hole and travels at the retract height.
 */
export function drillToolpath(
  operation: DrillOperation,
  shapes: Shape[],
  options: DrillOptions,
): Toolpath {
  const { tool, params } = operation;
  const warnings: ToolpathMessage[] = [];

  const radius = tool.diameter / 2;
  const slack = DRILL_DIAMETER_TOLERANCE / 2 + 1e-9;
  const found: Hole[] = [];
  let tooSmall = 0;
  let tooBig = 0;
  let other = 0;
  for (const shape of shapes) {
    for (const path of shape.paths) {
      if (path.segments.length === 0) {
        found.push({ center: path.start, bore: null });
        continue;
      }
      const round = path.closed ? roundness(path) : null;
      if (!round || !isRound(round)) other++;
      else if (round.max <= radius + slack && round.min >= radius - slack) {
        found.push({ center: round.center, bore: null });
      } else if (round.min < radius - slack) tooSmall++;
      else if (tool.type === "drill") tooBig++;
      else found.push({ center: round.center, bore: round.max - radius });
    }
  }
  if (tooSmall > 0)
    warnings.push({ code: "toolpath.skippedSmallCircles", values: { count: tooSmall } });
  if (tooBig > 0) {
    warnings.push({ code: "toolpath.skippedLargeCircles", values: { count: tooBig } });
  }
  if (other > 0) {
    warnings.push({ code: "toolpath.skippedNonCircles", values: { count: other } });
  }
  if (params.depth > tool.fluteLength) warnings.push({ code: "toolpath.depthExceedsFlutes" });

  const builder = new ToolpathBuilder(options.safeZ, options.entryClearance);
  const { clearance } = builder;
  const levels = params.peck ? depthLevels(params.depth, tool.stepDown) : [-params.depth];
  for (const { center, bore } of drillOrder(unique(found))) {
    const [x, y] = center;
    if (bore !== null) {
      boreHole(builder, center, bore, -params.depth, tool, params.stepOver);
      continue;
    }
    builder.travel(x, y);
    let bottom = 0;
    levels.forEach((level, i) => {
      if (i > 0) builder.rapid([x, y, clearance]);
      builder.rapid([x, y, bottom + clearance]);
      builder.feed([x, y, level], tool.plungeRate);
      bottom = level;
    });
  }
  builder.retract();
  return { moves: builder.moves, warnings };
}

/** Where to drill, and the radius the tool centre circles at to bore it out, or `null` to plunge. */
export type Hole = { center: Point; bore: number | null };

/** `holes` with one per centre: the widest bore, a plunge being the narrowest. */
function unique(holes: Hole[]): Hole[] {
  // Coinciding centres are in the same or a neighbouring cell.
  const cell = (value: number) => Math.floor(value / GEOMETRY_TOLERANCE);
  const grid = new Map<string, number[]>();
  const result: Hole[] = [];
  for (const hole of holes) {
    const [cx, cy] = [cell(hole.center[0]), cell(hole.center[1])];
    let index = -1;
    for (let dx = -1; dx <= 1 && index === -1; dx++) {
      for (let dy = -1; dy <= 1 && index === -1; dy++) {
        const candidates = grid.get(`${cx + dx},${cy + dy}`) ?? [];
        index =
          candidates.find((i) => pointsCoincide((result[i] as Hole).center, hole.center)) ?? -1;
      }
    }
    const kept = result[index];
    if (!kept) {
      const key = `${cx},${cy}`;
      grid.set(key, [...(grid.get(key) ?? []), result.length]);
      result.push(hole);
    } else if ((hole.bore ?? 0) > (kept.bore ?? 0)) result[index] = hole;
  }
  return result;
}

/**
 * Bores a hole whose wall the tool centre circles at `bore` around `center`,
 * down to `bottom`: one ring at `bore`, or when that would leave a core,
 * rings from the tool radius out to `bore` no further apart than its
 * step-over, inside out so the tool always has room on one side. Between
 * rings the tool goes over the top at the retract height, since the entry
 * clearance may be too close to the uncut stock between them; it leaves from
 * the centre.
 */
function boreHole(
  builder: ToolpathBuilder,
  center: Point,
  bore: number,
  bottom: number,
  tool: Tool,
  stepOverPercent: number,
) {
  const radius = tool.diameter / 2;
  const stepOver = (tool.diameter * stepOverPercent) / 100;
  const extra = bore > radius ? Math.ceil((bore - radius) / stepOver - 1e-9) : 0;
  for (let i = 0; i <= extra; i++) {
    const ring = extra === 0 ? bore : radius + ((bore - radius) * i) / extra;
    builder.travel(center[0] + ring, center[1]);
    boreRing(builder, center, ring, bottom, tool);
  }
  builder.feed([center[0], center[1], bottom], tool.feedRate);
}

/**
 * One ring of a bore, from `clearance` above its start down to `bottom`,
 * counter-clockwise so the wall is on the tool's right (climb milling): a
 * helix no steeper than the tool's plunge angle, dropping no more than its
 * step-down per turn, then a full turn at `bottom`. A ring too short to ramp
 * along (under the tool radius, as for pockets) is plunged instead, a
 * step-down at a time with a turn at each depth.
 */
function boreRing(
  builder: ToolpathBuilder,
  center: Point,
  ring: number,
  bottom: number,
  tool: Tool,
) {
  const { clearance } = builder;
  const chords = Math.ceil((2 * Math.PI) / arcStep(ring));
  const at = (i: number): Point => {
    const angle = (2 * Math.PI * i) / chords;
    return i % chords === 0
      ? [center[0] + ring, center[1]]
      : [center[0] + ring * Math.cos(angle), center[1] + ring * Math.sin(angle)];
  };
  const turn = (z: number) => {
    for (let i = 1; i <= chords; i++) {
      const [px, py] = at(i);
      builder.feed([px, py, z], tool.feedRate);
    }
  };
  const [sx, sy] = at(0);
  builder.rapid([sx, sy, clearance]);

  // The tool follows the chords, so the slope is measured along them.
  const length = chords * 2 * ring * Math.sin(Math.PI / chords);
  if (length < tool.diameter / 2) {
    for (const level of depthLevels(-bottom, tool.stepDown)) {
      builder.feed([sx, sy, level], tool.plungeRate);
      turn(level);
    }
    return;
  }
  const perTurn = Math.min(
    tool.stepDown,
    tool.plungeAngle < 90 ? length * Math.tan((tool.plungeAngle * Math.PI) / 180) : Infinity,
  );
  const total = Math.max(1, Math.ceil((clearance - bottom) / perTurn - 1e-9)) * chords;
  for (let i = 1; i <= total; i++) {
    const [px, py] = at(i);
    const z = i === total ? bottom : clearance + ((bottom - clearance) * i) / total;
    builder.feed([px, py, z], tool.plungeRate);
  }
  turn(bottom);
}

/**
 * Candidate checks 2-opt may make: enough to finish on hundreds of holes,
 * while thousands keep the worker responsive with a partly improved route.
 */
const MAX_TWO_OPT_CHECKS = 2_000_000;

/**
 * `holes` in drilling order: nearest neighbour from the hole nearest
 * `[0, 0]`, then 2-opt with that first hole kept first, up to
 * `MAX_TWO_OPT_CHECKS`.
 */
export function drillOrder<T extends { center: Point }>(holes: T[]): T[] {
  const left = [...holes];
  const route: T[] = [];
  let at: Point = [0, 0];
  while (left.length > 0) {
    let nearest = 0;
    let best = Infinity;
    for (let i = 0; i < left.length; i++) {
      const d = squaredDistance(at, (left[i] as T).center);
      if (d < best) {
        best = d;
        nearest = i;
      }
    }
    const next = left.splice(nearest, 1)[0] as T;
    route.push(next);
    at = next.center;
  }

  // Reversing route[i..j] replaces the moves into route[i] and out of
  // route[j] (if any) with ones into route[j] and out of route[i].
  let improved = true;
  let checks = 0;
  while (improved && checks < MAX_TWO_OPT_CHECKS) {
    improved = false;
    for (let i = 1; i < route.length - 1 && checks < MAX_TWO_OPT_CHECKS; i++) {
      for (let j = i + 1; j < route.length; j++) {
        checks++;
        const before = (route[i - 1] as T).center;
        const after = route[j + 1]?.center;
        const a = (route[i] as T).center;
        const b = (route[j] as T).center;
        const saving =
          length(before, a) +
          (after ? length(b, after) : 0) -
          length(before, b) -
          (after ? length(a, after) : 0);
        if (saving > 1e-9) {
          reverse(route, i, j);
          improved = true;
        }
      }
    }
  }
  return route;
}

// `Math.hypot` guards against overflow and is several times slower; these
// run millions of times on large hole counts.
function squaredDistance(a: Point, b: Point): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return dx * dx + dy * dy;
}

function length(a: Point, b: Point): number {
  return Math.sqrt(squaredDistance(a, b));
}

function reverse<T>(route: T[], from: number, to: number) {
  for (let i = from, j = to; i < j; i++, j--) {
    [route[i], route[j]] = [route[j] as T, route[i] as T];
  }
}
