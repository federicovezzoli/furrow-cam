import {
  GEOMETRY_TOLERANCE,
  type Point,
  type Shape,
  type Tool,
  type VCarveOperation,
} from "@furrow/document";
import { vBitConeDepth } from "./engrave";
import { DEFAULT_CHORD_TOLERANCE, flattenPath } from "./flatten";
import { difference, offset, type Polygon } from "./geometry";
import { type MedialAxisBranch, medialAxis } from "./medial-axis";
import { depthLevels, plural } from "./passes";
import { clearPocket, type PocketOptions } from "./pocket";
import { opening } from "./pocket-cut";
import type { Vec3 } from "./stock";
import { type Toolpath, ToolpathBuilder } from "./toolpath";

export type VCarveOptions = PocketOptions;

/**
 * A run of the V-bit: points with the final depth below the stock top at
 * each. A closed run ends on its first point and may start anywhere on it.
 */
type Run = { points: Point[]; depths: number[]; closed: boolean };

/**
 * The toolpath of a V-carve operation (PRD-0001 R16), in stock coordinates.
 *
 * - The area enclosed by the closed paths of all `shapes` is carved, nested
 *   rings toggling inside and outside (even-odd), so islands such as the
 *   middle of an O stay standing.
 * - The V-bit follows the area's medial axis (ADR-0025), at each point as
 *   deep as the bit's angle and tip need to reach the nearest edge: corners
 *   are carved right into, wide parts deeper. Nowhere deeper than the
 *   operation's maximum depth, nor than the bit's cone.
 * - Where the area is wider than the bit reaches at that limit, without a
 *   flat bottom the bit follows the axis at the limit and those edges stay
 *   uncarved (a warning says so). With one, the bit stops where the axis
 *   gets there and carves the walls instead, following the area inset by
 *   half its line width at the limit, and the flat-bottom end mill clears
 *   the floor inside them at the limit first, as an offset pocket (the
 *   toolpath's `clearing` moves).
 * - Each run is cut in equal passes no deeper than the V-bit's step-down,
 *   every pass only where the previous one didn't already reach the final
 *   depth, all passes of a run before the next, nearest first. Open runs
 *   alternate direction from pass to pass. The tool stays down from a run
 *   to one starting where it ended, at a junction of the axis; otherwise it
 *   retracts and plunges.
 * - Runs are simplified within the chord tolerance in 3D, depth included:
 *   the axis has a point every few tenths of a millimetre.
 */
export function vcarveToolpath(
  operation: VCarveOperation,
  shapes: Shape[],
  options: VCarveOptions,
): Toolpath {
  const { tool, params } = operation;
  const tolerance = options.tolerance ?? DEFAULT_CHORD_TOLERANCE;
  const warnings: string[] = [];

  const closed: Polygon[] = [];
  let open = 0;
  let points = 0;
  for (const shape of shapes) {
    for (const path of shape.paths) {
      if (path.segments.length === 0) points++;
      else if (path.closed) closed.push(flattenPath(path, tolerance).slice(0, -1));
      else open++;
    }
  }
  if (points > 0) warnings.push(`Skipped ${plural(points, "point")}: drill them instead.`);
  if (open > 0) {
    warnings.push(`Skipped ${plural(open, "open path")}: V-carving needs closed paths.`);
  }

  const cone = vBitConeDepth(tool);
  if (cone === null) throw new Error("Only V-bits V-carve");
  if (params.maxDepth > cone + 1e-9) {
    warnings.push("The maximum depth exceeds the V-bit's cone, so it carves no deeper than that.");
  }
  const limit = Math.min(params.maxDepth, cone);
  if (limit > tool.fluteLength) warnings.push("The depth exceeds the tool's flute length.");
  const tipRadius = (tool.tipDiameter ?? 0) / 2;
  const slope = Math.tan((((tool.vAngle as number) / 2) * Math.PI) / 180);
  /** Distance to the edges at which the bit reaches the limit: half its line width there. */
  const reach = tipRadius + limit * slope;
  const depthAt = (radius: number) => Math.max(0, Math.min(limit, (radius - tipRadius) / slope));

  const branches = closed.length > 0 ? medialAxis(closed, { fillRule: "evenOdd" }) : [];
  const flatBottom = params.flatBottom?.tool ?? null;
  const runs: Run[] = [];
  let clearing: Toolpath["moves"] | undefined;
  if (flatBottom) {
    for (const branch of branches) {
      for (const part of within(branch, reach)) {
        runs.push({ points: part.points, depths: part.radii.map(depthAt), closed: false });
      }
    }
    const walls = offset(closed, -reach, { fillRule: "evenOdd", arcTolerance: tolerance });
    for (const ring of walls) {
      if (ring.length < 3) continue;
      const loop = [...ring, ring[0] as Point];
      runs.push({ points: loop, depths: loop.map(() => limit), closed: true });
    }
    const pocket = clearPocket(
      flatBottom,
      {
        strategy: { type: "offset" },
        direction: "climb",
        depth: limit,
        allowance: 0,
        finishPass: false,
        ramp: true,
      },
      walls,
      options,
    );
    // An offset pocket only warns that nothing fits, which `missesFloor` covers.
    clearing = pocket.moves;
    if (missesFloor(walls, flatBottom, tolerance)) {
      warnings.push("Some flat areas are too narrow for the flat-bottom tool and stay uncut.");
    }
    if (limit > flatBottom.fluteLength) {
      warnings.push("The depth exceeds the flat-bottom tool's flute length.");
    }
  } else {
    let tooWide = false;
    for (const { points, radii } of branches) {
      if (radii.some((radius) => radius > reach + tolerance)) tooWide = true;
      runs.push({ points, depths: radii.map(depthAt), closed: false });
    }
    if (tooWide) {
      warnings.push(
        "Parts are wider than the V-bit reaches at the maximum depth, so their edges stay " +
          "uncarved: turn on a flat bottom to clear them.",
      );
    }
  }

  const builder = new ToolpathBuilder(options.safeZ, options.entryClearance);
  cutRuns(builder, tool, runs, depthLevels(limit, tool.stepDown), tolerance);
  builder.retract();
  return clearing
    ? { moves: builder.moves, clearing, warnings }
    : { moves: builder.moves, warnings };
}

/**
 * The parts of `branch` whose radius is at most `reach`, each ending exactly
 * at that radius where it is cut off.
 */
function within(branch: MedialAxisBranch, reach: number): MedialAxisBranch[] {
  const { points, radii } = branch;
  const parts: MedialAxisBranch[] = [];
  let current: MedialAxisBranch | null = null;
  for (let i = 0; i < points.length; i++) {
    const point = points[i] as Point;
    const radius = radii[i] as number;
    if (i > 0) {
      const before = points[i - 1] as Point;
      const r0 = radii[i - 1] as number;
      if (r0 <= reach !== radius <= reach) {
        const t = (reach - r0) / (radius - r0);
        const cut: Point = [
          before[0] + (point[0] - before[0]) * t,
          before[1] + (point[1] - before[1]) * t,
        ];
        if (current) {
          current.points.push(cut);
          current.radii.push(reach);
          parts.push(current);
          current = null;
        } else {
          current = { points: [cut], radii: [reach] };
        }
      }
    }
    if (radius <= reach) {
      current ??= { points: [], radii: [] };
      current.points.push(point);
      current.radii.push(radius);
    }
  }
  if (current) parts.push(current);
  return parts.filter((part) => part.points.length >= 2);
}

/**
 * Whether the floor inside `walls` has parts at least half the tool's radius
 * across that `tool` can't reach. The sharp corners it can't get into are
 * narrower than that and don't count.
 */
function missesFloor(walls: Polygon[], tool: Tool, tolerance: number): boolean {
  const radius = tool.diameter / 2;
  const options = { arcTolerance: tolerance };
  const reached = offset(offset(walls, -radius, options), radius, options);
  const missed = opening(difference(walls, reached), tolerance);
  return offset(missed, -radius / 4, options).length > 0;
}

/** Cuts every run at each of `levels`, nearest first. */
function cutRuns(
  builder: ToolpathBuilder,
  tool: Tool,
  runs: Run[],
  levels: number[],
  tolerance: number,
) {
  const steepest = (tool.plungeAngle * Math.PI) / 180;
  const feed = (to: Vec3) => {
    const at = builder.position;
    const drop = at ? at[2] - to[2] : 0;
    const steep =
      at !== null &&
      drop > 0 &&
      Math.atan2(drop, Math.hypot(to[0] - at[0], to[1] - at[1])) > steepest + 1e-9;
    builder.feed(to, steep ? tool.plungeRate : tool.feedRate);
  };
  const enter = (to: Vec3) => {
    const at = builder.position;
    if (!at || Math.hypot(at[0] - to[0], at[1] - to[1]) >= GEOMETRY_TOLERANCE) {
      builder.travel(to[0], to[1]);
      builder.rapid([to[0], to[1], builder.clearance]);
      builder.feed(to, tool.plungeRate);
      return;
    }
    // At a junction: the run before ended here.
    feed(to);
  };

  for (const run of nearestRuns(runs)) {
    let forward = true;
    /** The point of an open run the tool is at, once it has cut some of it. */
    let at: number | null = null;
    /** Point `index` of the run at `depth`, or its final depth if that is shallower. */
    const point = (index: number, depth: number): Vec3 => {
      const [x, y] = run.points[index] as Point;
      return [x, y, -Math.min(run.depths[index] as number, depth)];
    };
    levels.forEach((z, i) => {
      const cleared = -(levels[i - 1] ?? 0);
      let sections = deeperThan(run, cleared);
      if (!forward) sections = sections.reverse().map((section) => section.reverse());
      for (const section of sections) {
        const start = section[0] as number;
        if (at === null) enter(point(start, -z));
        else {
          // Along the groove the passes before cut, rather than up and over.
          const link: Vec3[] = [];
          for (let j = at; j !== start; j += start > at ? 1 : -1) link.push(point(j, cleared));
          link.push(point(start, cleared));
          for (const next of simplify3d(link, tolerance).slice(1)) feed(next);
        }
        const path = section.map((index) => point(index, -z));
        for (const next of simplify3d(path, tolerance)) feed(next);
        if (!run.closed) at = section.at(-1) as number;
      }
      if (!run.closed) forward = !forward;
    });
  }
}

/**
 * The stretches of `run` where its final depth is below `cleared`, as point
 * indices, each with the point before and after it, which the pass before
 * already cut to their final depth.
 */
function deeperThan(run: Run, cleared: number): number[][] {
  const sections: number[][] = [];
  let current: number[] | null = null;
  const count = run.points.length;
  for (let i = 0; i < count; i++) {
    if ((run.depths[i] as number) > cleared + 1e-9) {
      if (!current) {
        current = i > 0 ? [i - 1] : [];
        sections.push(current);
      }
      current.push(i);
    } else if (current) {
      current.push(i);
      current = null;
    }
  }
  return sections.filter((section) => section.length >= 2);
}

/**
 * `runs` in cutting order, nearest first from the first one: open runs from
 * whichever end is nearer, closed runs from their nearest point.
 */
function nearestRuns(runs: Run[]): Run[] {
  const left = [...runs];
  const ordered: Run[] = [];
  let at: Point | null = null;
  while (left.length > 0) {
    let best = 0;
    let bestDistance = Infinity;
    let bestStart = 0;
    left.forEach((run, i) => {
      if (at === null) return;
      const here = at;
      const candidates = run.closed ? run.points.map((_, j) => j) : [0, run.points.length - 1];
      for (const j of candidates) {
        const point = run.points[j] as Point;
        const d = Math.hypot(point[0] - here[0], point[1] - here[1]);
        if (d < bestDistance) {
          bestDistance = d;
          best = i;
          bestStart = j;
        }
      }
    });
    const [run] = left.splice(best, 1) as [Run];
    const started = startAt(run, bestStart);
    ordered.push(started);
    at = started.points.at(-1) as Point;
  }
  return ordered;
}

/** `run` starting at point `index`: reversed if it is the end of an open run, rotated if closed. */
function startAt(run: Run, index: number): Run {
  if (index === 0) return run;
  if (!run.closed) {
    return { ...run, points: [...run.points].reverse(), depths: [...run.depths].reverse() };
  }
  // Closed runs repeat their first point at the end.
  const rotate = <T>(values: T[]) => {
    const body = values.slice(0, -1);
    const rotated = [...body.slice(index), ...body.slice(0, index)];
    return [...rotated, rotated[0] as T];
  };
  return { ...run, points: rotate(run.points), depths: rotate(run.depths) };
}

/** `points` without those within `tolerance` of the line through their neighbours kept (Douglas–Peucker). */
export function simplify3d(points: Vec3[], tolerance: number): Vec3[] {
  if (points.length <= 2) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [from, to] = stack.pop() as [number, number];
    const a = points[from] as Vec3;
    const b = points[to] as Vec3;
    let worst = -1;
    let worstDistance = tolerance;
    for (let i = from + 1; i < to; i++) {
      const d = distanceToSegment3d(points[i] as Vec3, a, b);
      if (d > worstDistance) {
        worstDistance = d;
        worst = i;
      }
    }
    if (worst === -1) continue;
    keep[worst] = 1;
    stack.push([from, worst], [worst, to]);
  }
  return points.filter((_, i) => keep[i]);
}

function distanceToSegment3d([px, py, pz]: Vec3, [ax, ay, az]: Vec3, [bx, by, bz]: Vec3): number {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const length2 = dx * dx + dy * dy + dz * dz;
  const t =
    length2 > 0
      ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy + (pz - az) * dz) / length2))
      : 0;
  return Math.hypot(ax + t * dx - px, ay + t * dy - py, az + t * dz - pz);
}
