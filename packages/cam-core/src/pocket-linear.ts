import { distance, type LinearAngle, type Point } from "@furrow/document";
import {
  type Cut,
  cutRing,
  feedAlong,
  type Layout,
  nearestFirst,
  type Piece,
  type Ring,
  reach,
  staysDown,
} from "./pocket-cut";

// Linear clearing (#57): zig-zag passes at a preset angle between the laps
// around a piece's walls and islands.

/** Where a pass meets a lap: the point, the lap (an index into the piece's rings) and how far along it. */
type End = { point: Point; ring: number; at: number };

/** A straight cut across the piece from lap to lap, on line `line`. */
type Pass = { ends: [End, End]; line: number };

export type LinearPlan = {
  kind: "linear";
  /** The passes on each line, lines one step-over apart. */
  lines: Pass[][];
  /** Position across the passes, in millimetres. */
  across: (point: Point) => number;
  tolerance: number;
};

/**
 * The passes clearing `piece` at `angle` (degrees counter-clockwise from the
 * X axis): along lines one step-over apart from the piece's edge, each split
 * where the line crosses the piece's laps. The laps clear what the lines
 * leave near them, so lines nearer the far edge than the tolerance are left
 * out, and so are passes shorter than it.
 */
export function linearPlan(piece: Piece, angle: LinearAngle, layout: Layout): LinearPlan {
  const radians = (angle * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const along = ([x, y]: Point) => x * cos + y * sin;
  const across = ([x, y]: Point) => y * cos - x * sin;
  const { stepOver, tolerance } = layout;

  const positions = piece.area.outer.map(across);
  const min = Math.min(...positions);
  const max = Math.max(...positions);
  const lines: Pass[][] = [];
  for (let v = min + stepOver; v < max - tolerance; v += stepOver) {
    const crossings: End[] = [];
    piece.rings.forEach(({ loop }, ring) => {
      let at = 0;
      for (let i = 1; i < loop.length; i++) {
        const a = loop[i - 1] as Point;
        const b = loop[i] as Point;
        const va = across(a);
        const vb = across(b);
        // Half-open, so a line through a vertex crosses one of its edges.
        if (va <= v !== vb <= v) {
          const t = (v - va) / (vb - va);
          const point: Point = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
          crossings.push({ point, ring, at: at + t * distance(a, b) });
        }
        at += distance(a, b);
      }
    });
    crossings.sort((a, b) => along(a.point) - along(b.point));
    const passes: Pass[] = [];
    for (let i = 0; i + 1 < crossings.length; i += 2) {
      const ends: [End, End] = [crossings[i] as End, crossings[i + 1] as End];
      if (distance(ends[0].point, ends[1].point) > tolerance) {
        passes.push({ ends, line: lines.length });
      }
    }
    lines.push(passes);
  }
  return { kind: "linear", lines, across, tolerance };
}

/**
 * Clears `piece` at `z`: a lap of each of its rings first, entered like an
 * offset ring, then the passes, each from lap to lap so the tool enters them
 * at depth. A pass is linked to the next on a neighbouring line along the
 * lap when the link stays between the two lines, within one step-over, which
 * makes the passes zig-zag; otherwise the tool gets to the nearest pass left
 * through the cleared depth, or over the top, and goes straight down onto the
 * cleared lap.
 */
export function cutLinear(
  cut: Cut,
  piece: Piece,
  plan: LinearPlan,
  container: Piece,
  z: number,
  clearedZ: number,
) {
  for (const ring of nearestFirst(cut, piece.rings, (ring) => [ring.loop])) {
    cutRing(cut, ring, piece, container, z, clearedZ);
  }
  const left = new Set(plan.lines.flat());
  let last: { end: End; line: number } | null = null;
  let sweep = 1;
  while (left.size > 0) {
    const linked = last && link(plan, piece.rings, left, last, sweep);
    let pass: Pass;
    let start: End;
    if (linked) {
      ({ pass, start } = linked);
      if (last) sweep = Math.sign(pass.line - last.line);
      feedAlong(cut, linked.path, z);
    } else {
      ({ pass, start } = nearestPass(cut, left, container, clearedZ));
      reach(cut, start.point, container, clearedZ);
      // Through the lap, which this level has cleared.
      cut.builder.feed([start.point[0], start.point[1], z], cut.plungeRate);
    }
    const end = pass.ends[0] === start ? pass.ends[1] : pass.ends[0];
    feedAlong(cut, [end.point], z);
    left.delete(pass);
    last = { end, line: pass.line };
  }
}

/**
 * The pass left on a line next to `last` (the line in the sweep's direction
 * first) that the shortest link along the lap reaches from `last.end`
 * without leaving the strip between the two lines, with that link.
 */
function link(
  plan: LinearPlan,
  rings: Ring[],
  left: Set<Pass>,
  last: { end: End; line: number },
  sweep: number,
): { pass: Pass; start: End; path: Point[] } | null {
  for (const step of [sweep, -sweep]) {
    let best: { pass: Pass; start: End; path: Point[]; length: number } | null = null;
    for (const pass of plan.lines[last.line + step] ?? []) {
      if (!left.has(pass)) continue;
      for (const start of pass.ends) {
        const ring = rings[start.ring];
        if (start.ring !== last.end.ring || !ring) continue;
        const lo = Math.min(plan.across(last.end.point), plan.across(start.point));
        const hi = Math.max(plan.across(last.end.point), plan.across(start.point));
        for (const path of lapPaths(ring, last.end.at, start.at)) {
          const inStrip = path.every((point) => {
            const v = plan.across(point);
            return v >= lo - plan.tolerance && v <= hi + plan.tolerance;
          });
          const length = pathLength(last.end.point, path);
          if (inStrip && (!best || length < best.length)) best = { pass, start, path, length };
        }
      }
    }
    if (best) return best;
  }
  return null;
}

/** The two ways along `ring` from `from` to `to` millimetres along it, as the points after `from`. */
function lapPaths({ track }: Ring, from: number, to: number): Point[][] {
  const forward = (((to - from) % track.length) + track.length) % track.length;
  const ahead = [...track.walk(from, forward)].map(([point]) => point);
  // Walked from `to` to `from`, then turned round.
  const behind = [track.pointAt(to), ...[...track.walk(to, track.length - forward)].map(([p]) => p)]
    .reverse()
    .slice(1);
  return [ahead, behind];
}

function pathLength(from: Point, path: Point[]): number {
  let length = 0;
  let previous = from;
  for (const point of path) {
    length += distance(previous, point);
    previous = point;
  }
  return length;
}

/**
 * The pass left with an end nearest to the tool, and that end: of those the
 * tool reaches without retracting, if any.
 */
function nearestPass(
  cut: Cut,
  left: Set<Pass>,
  container: Piece,
  clearedZ: number,
): { pass: Pass; start: End } {
  const here = cut.builder.position;
  let best: { pass: Pass; start: End; down: boolean; distance: number } | null = null;
  for (const pass of left) {
    for (const start of pass.ends) {
      const d = here ? distance([here[0], here[1]], start.point) : 0;
      if (best?.down && d >= best.distance) continue;
      const down = staysDown(cut, start.point, container, clearedZ);
      if (!best || (down && !best.down) || (down === best.down && d < best.distance)) {
        best = { pass, start, down, distance: d };
      }
    }
  }
  if (!best) throw new Error("No passes left");
  return best;
}
