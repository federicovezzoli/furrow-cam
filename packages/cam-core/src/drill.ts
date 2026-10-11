import {
  type DrillOperation,
  distance,
  GEOMETRY_TOLERANCE,
  type Path,
  type Point,
  pointsCoincide,
  type Shape,
  type Tool,
} from "@furrow/document";
import { DEFAULT_CHORD_TOLERANCE, flattenPath } from "./flatten";
import { depthLevels, ENTRY_CLEARANCE, plural } from "./passes";
import { projectOnLoop } from "./tabs";
import { type Toolpath, ToolpathBuilder } from "./toolpath";

/** How far, in millimetres, a circle's diameter may be from the tool's for it to be drilled. */
export const DRILL_DIAMETER_TOLERANCE = 0.1;

export type DrillOptions = {
  /** Retract height above the stock top. */
  safeZ: number;
};

/**
 * The toolpath of a drill operation (PRD-0001 R8), in stock coordinates.
 *
 * - Holes are at single-point paths and at the centre of each closed path
 *   a circle fits: every point of the outline within half of
 *   `DRILL_DIAMETER_TOLERANCE` of one radius. That takes in circles drawn as
 *   arcs, and circles exported as polygons or Béziers, with no guess at what
 *   is meant as a circle: a coarse polygon has no circle that fits it. The
 *   hole's size is the circle through its farthest points, so the hole
 *   contains the drawn outline. Other paths are skipped.
 * - A point, or a circle the tool fits within that tolerance, is drilled:
 *   without pecking the tool feeds straight to `depth` at its plunge rate;
 *   pecking splits the depth into equal pecks no deeper than the tool's
 *   step-down, and after each the tool rapids up to just above the stock to
 *   clear the chips, then back down to just above the bottom of the last.
 * - A larger circle is bored by an end mill: a climb-milling helix down from
 *   just above the stock, no steeper than the tool's plunge angle and
 *   dropping no more than its step-down per turn, then a full turn at depth.
 *   A drill bit can't cut sideways, so it skips them; circles smaller than
 *   the tool are skipped too.
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
  const warnings: string[] = [];

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
      if (!round || round.max - round.min > 2 * slack) other++;
      else if (round.max <= radius + slack && round.min >= radius - slack) {
        found.push({ center: round.center, bore: null });
      } else if (round.min < radius - slack) tooSmall++;
      else if (tool.type === "drill") tooBig++;
      else found.push({ center: round.center, bore: round.max - radius });
    }
  }
  if (tooSmall > 0) warnings.push(`Skipped ${plural(tooSmall, "circle")} smaller than the tool.`);
  if (tooBig > 0) {
    warnings.push(
      `Skipped ${plural(tooBig, "circle")} larger than the drill: bore them with an end mill.`,
    );
  }
  if (other > 0) {
    warnings.push(`Skipped ${plural(other, "path")}: drilling needs circles or points.`);
  }
  if (params.depth > tool.fluteLength) warnings.push("The depth exceeds the tool's flute length.");

  const builder = new ToolpathBuilder(options.safeZ);
  const clearance = Math.min(ENTRY_CLEARANCE, options.safeZ);
  const levels = params.peck ? depthLevels(params.depth, tool.stepDown) : [-params.depth];
  for (const { center, bore } of drillOrder(unique(found))) {
    const [x, y] = center;
    if (bore !== null) {
      boreHelix(builder, center, bore, -params.depth, clearance, tool);
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
  const result: Hole[] = [];
  for (const hole of holes) {
    const i = result.findIndex((other) => pointsCoincide(other.center, hole.center));
    const kept = result[i];
    if (!kept) result.push(hole);
    else if ((hole.bore ?? 0) > (kept.bore ?? 0)) result[i] = hole;
  }
  return result;
}

/**
 * Bores a hole: a climb-milling helix at `bore` around `center`, from
 * `clearance` down to `bottom`, no steeper than the tool's plunge angle and
 * dropping no more than its step-down per turn; then a full turn at `bottom`
 * to clean the wall, and to the centre to leave it.
 */
function boreHelix(
  builder: ToolpathBuilder,
  center: Point,
  bore: number,
  bottom: number,
  clearance: number,
  tool: Tool,
) {
  const [x, y] = center;
  const circumference = 2 * Math.PI * bore;
  const perTurn = Math.min(
    tool.stepDown,
    tool.plungeAngle < 90 ? circumference * Math.tan((tool.plungeAngle * Math.PI) / 180) : Infinity,
  );
  const turns = Math.max(1, Math.ceil((clearance - bottom) / perTurn - 1e-9));
  // Chords within the chord tolerance of the circle, at least a quarter turn each.
  const step = Math.min(
    Math.PI / 2,
    bore > DEFAULT_CHORD_TOLERANCE
      ? 2 * Math.acos(1 - DEFAULT_CHORD_TOLERANCE / bore)
      : Math.PI / 2,
  );
  const chords = Math.ceil((2 * Math.PI) / step);
  // Counter-clockwise, so the wall is on the tool's right: climb milling.
  const at = (i: number): Point => {
    const angle = (2 * Math.PI * i) / chords;
    return i % chords === 0
      ? [x + bore, y]
      : [x + bore * Math.cos(angle), y + bore * Math.sin(angle)];
  };

  builder.travel(x + bore, y);
  builder.rapid([x + bore, y, clearance]);
  const total = turns * chords;
  for (let i = 1; i <= total; i++) {
    const [px, py] = at(i);
    builder.feed(
      [px, py, i === total ? bottom : clearance + ((bottom - clearance) * i) / total],
      tool.plungeRate,
    );
  }
  for (let i = 1; i <= chords; i++) {
    const [px, py] = at(i);
    builder.feed([px, py, bottom], tool.feedRate);
  }
  builder.feed([x, y, bottom], tool.feedRate);
}

/**
 * The centre of a closed path and the nearest and farthest its outline comes
 * to it: exact for a circle of arcs, otherwise from the path flattened, around
 * the centroid of its area. `null` for a path enclosing no area.
 */
function roundness(path: Path): { center: Point; min: number; max: number } | null {
  const circle = arcCircle(path);
  if (circle) return { center: circle.center, min: circle.radius, max: circle.radius };
  const loop = flattenPath(path);
  const center = centroid(loop);
  if (!center) return null;
  const max = Math.max(...loop.map((point) => distance(center, point)));
  return { center, min: projectOnLoop(loop, center).distance, max };
}

/** The circle `path` traces, if it is a closed path of arcs around one centre with one radius. */
function arcCircle(path: Path): { center: Point; radius: number } | null {
  const [first] = path.segments;
  if (first?.kind !== "arc") return null;
  const center = first.center;
  const radius = distance(center, path.start);
  for (const segment of path.segments) {
    if (segment.kind !== "arc" || !pointsCoincide(segment.center, center)) return null;
    if (Math.abs(distance(center, segment.to) - radius) > GEOMETRY_TOLERANCE) return null;
  }
  const end = path.segments.at(-1)?.to ?? path.start;
  return pointsCoincide(end, path.start) ? { center, radius } : null;
}

/** The centroid of the area a closed polyline (ending on its first point) encloses, if any. */
function centroid(loop: Point[]): Point | null {
  let area = 0;
  let x = 0;
  let y = 0;
  for (let i = 1; i < loop.length; i++) {
    const [ax, ay] = loop[i - 1] as Point;
    const [bx, by] = loop[i] as Point;
    const cross = ax * by - bx * ay;
    area += cross;
    x += (ax + bx) * cross;
    y += (ay + by) * cross;
  }
  if (Math.abs(area / 2) <= GEOMETRY_TOLERANCE ** 2) return null;
  return [x / (3 * area), y / (3 * area)];
}

/**
 * `holes` in drilling order: nearest neighbour from the hole nearest
 * `[0, 0]`, then 2-opt with that first hole kept first.
 */
export function drillOrder<T extends { center: Point }>(holes: T[]): T[] {
  const left = [...holes];
  const route: T[] = [];
  let at: Point = [0, 0];
  while (left.length > 0) {
    let nearest = 0;
    for (let i = 1; i < left.length; i++) {
      const candidate = (left[i] as T).center;
      if (distance(at, candidate) < distance(at, (left[nearest] as T).center)) nearest = i;
    }
    const next = left.splice(nearest, 1)[0] as T;
    route.push(next);
    at = next.center;
  }

  // Reversing route[i..j] replaces the moves into route[i] and out of
  // route[j] (if any) with ones into route[j] and out of route[i].
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 1; i < route.length - 1; i++) {
      for (let j = i + 1; j < route.length; j++) {
        const before = (route[i - 1] as T).center;
        const after = route[j + 1]?.center;
        const a = (route[i] as T).center;
        const b = (route[j] as T).center;
        const saving =
          distance(before, a) +
          (after ? distance(b, after) : 0) -
          distance(before, b) -
          (after ? distance(a, after) : 0);
        if (saving > 1e-9) {
          reverse(route, i, j);
          improved = true;
        }
      }
    }
  }
  return route;
}

function reverse<T>(route: T[], from: number, to: number) {
  for (let i = from, j = to; i < j; i++, j--) {
    [route[i], route[j]] = [route[j] as T, route[i] as T];
  }
}
