import { distance, type PeelStart, type Point } from "@furrow/document";
import { flattenPath } from "./flatten";
import {
  containmentIn,
  difference,
  intersection,
  nest,
  offset,
  type Polygon,
  signedArea,
  simplify,
} from "./geometry";
import { type Box, bounds, descend, Track } from "./passes";
import {
  type Cut,
  canStep,
  covers,
  cutRing,
  feedAlong,
  type Layout,
  nearestFirst,
  opening,
  type Piece,
  pieces,
  polygons,
  type Ring,
  reach,
  staysDown,
} from "./pocket-cut";
import { projectOnLoop } from "./tabs";

// Peel clearing (#57): the cleared area grows a step-over at a time from a
// starting cut, and only what each step adds to its boundary is cut, so the
// tool never cuts wider than the step-over after the starting cut.

export const PEEL_ISLAND_WARNING = "Peel from the island needs exactly one island.";

/**
 * Something to cut along the boundary of the cleared area: a whole ring, or
 * an arc from one cut stretch of the boundary to another. `piece` is the
 * cleared area it bounds.
 */
type Front = (
  | { kind: "ring"; ring: Ring; piece: Piece }
  | { kind: "arc"; points: Point[]; piece: Piece }
) & {
  /** The fronts of earlier steps that clear the area next to it, cut before it. */
  after: Front[];
};

export type PeelPlan = {
  kind: "peel";
  /** The starting cut. */
  seed: Front[];
  /** The point a starting helix wider than the tool leaves standing, crossed after it. */
  core: Point | null;
  /** What the steps add to the cleared area's boundary, each after what it needs. */
  fronts: Front[];
};

/**
 * Gives each of `roots`, the pieces clearing `area`, its peel plan. The
 * cleared area starts as:
 * - `centre`: a circle one step-over across the point furthest from the walls
 *   and islands, or as much of it as fits;
 * - `inside`: the lap around the island of the root's pocket (`area` has
 *   exactly one island per pocket), or, for a root a neck keeps away from the
 *   island, its outer lap;
 * - `outside`: the outer lap;
 * and then grows a step-over at a time, staying in the root and going round
 * its islands, until it covers the root.
 */
export function peelPlans(
  roots: Piece[],
  area: Polygon[],
  start: PeelStart,
  clearing: number,
  layout: Layout,
) {
  const pockets = start === "inside" ? nest(area) : [];
  for (const root of roots) {
    let seed: Seed | null = null;
    if (start === "centre") seed = centreSeed(root, layout);
    if (start === "inside") {
      const island = pockets.find(({ outer, holes }) => {
        const point = root.area.outer[0] as Point;
        const inOuter = containmentIn(outer)(point) !== "outside";
        return inOuter && holes.every((hole) => containmentIn(hole)(point) !== "inside");
      })?.holes[0];
      if (island) seed = islandSeed(root, island, clearing, layout);
    }
    seed ??= outerSeed(root, layout);
    root.plan = {
      kind: "peel",
      seed: seed.fronts,
      core: seed.core,
      fronts: grow(root, seed.cleared, layout),
    };
  }
}

/** The starting cut, the area it clears and the point it leaves standing, if any. */
type Seed = { fronts: Front[]; cleared: Polygon[]; core: Point | null };

function centreSeed(root: Piece, layout: Layout): Seed {
  const { stepOver, radius, tolerance } = layout;
  const centre = furthestPoint(root, tolerance);
  const circle = flattenPath(
    {
      start: [centre[0] + stepOver, centre[1]],
      segments: [
        { kind: "arc", to: [centre[0] + stepOver, centre[1]], center: centre, clockwise: false },
      ],
      closed: true,
    },
    tolerance,
  ).slice(0, -1);
  // Where the circle doesn't fit, as much of it as does around the centre.
  const fitting = pieces(intersection([circle], polygons(root)), layout);
  const piece = fitting.find((candidate) => covers(candidate, centre)) ?? fitting[0];
  if (!piece) return outerSeed(root, layout);
  return {
    fronts: piece.rings.map((ring) => ({ kind: "ring", ring, piece, after: [] })),
    cleared: polygons(piece),
    // The tool centre's circle clears its middle only when it's no wider than the tool.
    core: stepOver > radius ? centre : null,
  };
}

function islandSeed(root: Piece, island: Polygon, clearing: number, layout: Layout): Seed | null {
  const { tolerance } = layout;
  const zone = offset([island], clearing + tolerance, { arcTolerance: tolerance });
  // What's outside the zone counts as cut, leaving the lap around the island.
  const outside = difference(polygons(root), zone);
  const fronts = frontsOf(root, outside, tolerance);
  if (fronts.length === 0) return null;
  return { fronts, cleared: intersection(polygons(root), zone), core: null };
}

function outerSeed(root: Piece, layout: Layout): Seed {
  const { tolerance } = layout;
  const inner = offset([root.area.outer], -tolerance, { arcTolerance: tolerance });
  return {
    fronts: frontsOf(root, inner, tolerance),
    cleared: difference(polygons(root), inner),
    core: null,
  };
}

/**
 * The fronts of each step growing `cleared` by the step-over inside `root`,
 * until a step adds nothing to its boundary. With a step-over over the tool
 * radius, each step also gets rings around what is further than that from
 * both its boundary and the last one, like offset clearing's centres.
 *
 * Each front comes after the fronts of earlier steps within a tool diameter
 * and a step-over of it: those clear the area the tool cuts next to, so once
 * they are cut it can be, wherever the other fronts of its step are.
 */
function grow(root: Piece, cleared: Polygon[], layout: Layout): Front[] {
  const { stepOver, radius, tolerance } = layout;
  const options = { arcTolerance: tolerance };
  const rootArea = polygons(root);
  const reach = 2 * radius + stepOver + tolerance;
  const placed: { line: Point[]; box: Box; front: Front }[] = [];
  const place = (fronts: Front[]) => {
    const lines = fronts.map((front) => {
      const line = front.kind === "ring" ? front.ring.loop : front.points;
      return { line, box: bounds(line), front };
    });
    for (const { line, box, front } of lines) {
      for (const earlier of placed) {
        if (overlap(box, earlier.box, reach) && linesWithin(line, earlier.line, reach)) {
          front.after.push(earlier.front);
        }
      }
    }
    placed.push(...lines);
  };
  let area = Math.abs(totalArea(cleared));
  for (;;) {
    const near = offset(cleared, tolerance, options);
    // Simplified before it meets the walls, which stay as they are.
    const grown = simplify(offset(cleared, stepOver, options), tolerance / 2);
    const next = connected(intersection(grown, rootArea), near);
    const nextArea = Math.abs(totalArea(next));
    // Rounding can't grow it by a square tolerance; real growth is a step-over wide.
    if (nextArea <= area + tolerance * tolerance) break;
    const fronts = pieces(next, layout).flatMap((piece) => frontsOf(piece, near, tolerance));
    if (fronts.length === 0) break;
    place(fronts);
    if (stepOver > radius) {
      const deep = offset(next, -radius, options);
      const left = opening(difference(deep, offset(cleared, radius, options)), tolerance);
      place(
        pieces(left, layout).flatMap((piece) =>
          piece.rings.map((ring): Front => ({ kind: "ring", ring, piece, after: [] })),
        ),
      );
    }
    cleared = next;
    area = nextArea;
  }
  return placed.map(({ front }) => front);
}

function overlap(a: Box, b: Box, margin: number): boolean {
  return (
    a.minX - margin <= b.maxX &&
    b.minX - margin <= a.maxX &&
    a.minY - margin <= b.maxY &&
    b.minY - margin <= a.maxY
  );
}

/** Whether polylines `a` and `b` come within `limit` of each other. */
function linesWithin(a: Point[], b: Point[], limit: number): boolean {
  const near = (points: Point[], line: Point[]) =>
    points.some((point) => {
      for (let i = 1; i < line.length; i++) {
        if (segmentDistanceSquared(point, line[i - 1] as Point, line[i] as Point) <= limit ** 2) {
          return true;
        }
      }
      return line.length === 1 && distance(point, line[0] as Point) <= limit;
    });
  return near(a, b) || near(b, a);
}

function segmentDistanceSquared(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared > 0
      ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lengthSquared))
      : 0;
  const x = a[0] + t * dx - p[0];
  const y = a[1] + t * dy - p[1];
  return x * x + y * y;
}

/** The parts of `polygons` that touch `near`: growing never jumps a gap. */
function connected(polygons: Polygon[], near: Polygon[]): Polygon[] {
  const parts = nest(polygons);
  if (parts.length <= 1) return polygons;
  return parts
    .map((part) => [part.outer, ...part.holes])
    .filter((part) => intersection(part, near).length > 0)
    .flat();
}

/**
 * What of `piece`'s rings is not in `old`: whole rings, or arcs between the
 * stretches of a ring in it. Arcs shorter than `tolerance` are left out.
 */
function frontsOf(piece: Piece, old: Polygon[], tolerance: number): Front[] {
  const isOld = within(old);
  const fronts: Front[] = [];
  for (const ring of piece.rings) {
    const points = split(ring.loop, old);
    const n = points.length - 1;
    // Each edge is wholly in or out of `old` once split where it crosses it.
    const oldEdge = points.slice(0, n).map((a, i) => {
      const b = points[i + 1] as Point;
      return isOld([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
    });
    const first = oldEdge.indexOf(true);
    if (first === -1) {
      fronts.push({ kind: "ring", ring, piece, after: [] });
      continue;
    }
    // Round the ring from an old edge, collecting the runs of new ones.
    let arc: Point[] | null = null;
    for (let k = 1; k <= n; k++) {
      const i = (first + k) % n;
      if (oldEdge[i]) {
        if (arc) fronts.push({ kind: "arc", points: arc, piece, after: [] });
        arc = null;
      } else {
        arc ??= [points[i] as Point];
        arc.push(points[i + 1] as Point);
      }
    }
  }
  return fronts.filter(
    (front) => front.kind === "ring" || new Track(front.points).length > tolerance,
  );
}

/** `loop` with a point added wherever it crosses a ring of `polygons`. */
function split(loop: Point[], polygons: Polygon[]): Point[] {
  const result: Point[] = [loop[0] as Point];
  for (let i = 1; i < loop.length; i++) {
    const a = loop[i - 1] as Point;
    const b = loop[i] as Point;
    const at: number[] = [];
    for (const ring of polygons) {
      for (let j = 0; j < ring.length; j++) {
        const t = crossing(a, b, ring[j] as Point, ring[(j + 1) % ring.length] as Point);
        if (t !== null) at.push(t);
      }
    }
    at.sort((x, y) => x - y);
    for (const t of at) result.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    result.push(b);
  }
  return result;
}

/** Where along `ab` (0 to 1, ends excluded) it crosses `cd`, or `null`. */
function crossing(a: Point, b: Point, c: Point, d: Point): number | null {
  const rx = b[0] - a[0];
  const ry = b[1] - a[1];
  const sx = d[0] - c[0];
  const sy = d[1] - c[1];
  const denominator = rx * sy - ry * sx;
  if (denominator === 0) return null;
  const t = ((c[0] - a[0]) * sy - (c[1] - a[1]) * sx) / denominator;
  const u = ((c[0] - a[0]) * ry - (c[1] - a[1]) * rx) / denominator;
  return t > 0 && t < 1 && u >= 0 && u <= 1 ? t : null;
}

/** Whether a point is in the area of `polygons` (outer boundaries and their holes), its boundary included. */
function within(polygons: Polygon[]): (point: Point) => boolean {
  const tests = polygons.map(containmentIn);
  return (point) => {
    let inside = 0;
    for (const test of tests) if (test(point) !== "outside") inside++;
    // A point on a hole's ring counts as in it, and so in the area.
    return inside % 2 === 1 || tests.some((test) => test(point) === "on");
  };
}

function totalArea(polygons: Polygon[]): number {
  return polygons.reduce((sum, polygon) => sum + signedArea(polygon), 0);
}

/** The point of `piece` furthest from its rings, within `tolerance`. */
function furthestPoint(piece: Piece, tolerance: number): Point {
  const area = polygons(piece);
  const options = { arcTolerance: tolerance };
  let lo = 0;
  let hi = Math.min(piece.box.maxX - piece.box.minX, piece.box.maxY - piece.box.minY) / 2;
  let deepest = area;
  while (hi - lo > tolerance) {
    const mid = (lo + hi) / 2;
    const inner = offset(area, -mid, options);
    if (inner.length > 0) {
      lo = mid;
      deepest = inner;
    } else {
      hi = mid;
    }
  }
  const [part] = nest(deepest);
  const ring = part?.outer ?? piece.area.outer;
  const middle: Point = [
    ring.reduce((sum, [x]) => sum + x, 0) / ring.length,
    ring.reduce((sum, [, y]) => sum + y, 0) / ring.length,
  ];
  return covers(piece, middle) ? middle : (ring[0] as Point);
}

/**
 * Peels the root at `z`: the starting cut, entered like an offset ring (an
 * arc ramps back and forth along itself), the cut across a core it leaves,
 * then the fronts, each time the nearest one whose earlier fronts are cut. A
 * front is entered by stepping over from where the tool is when that stays
 * inside the area it bounds; otherwise the tool gets there through the
 * cleared depth, or over the top, and a ring is entered like an offset ring
 * and an arc, which starts on a cut stretch, straight down.
 */
export function cutPeel(cut: Cut, plan: PeelPlan, container: Piece, z: number, clearedZ: number) {
  for (const front of nearestFirst(cut, plan.seed, startLines)) {
    if (front.kind === "ring") {
      cutRing(cut, front.ring, front.piece, container, z, clearedZ);
    } else {
      const [start, ...rest] = front.points as [Point, ...Point[]];
      reach(cut, start, container, clearedZ);
      descend(cut, front.points, clearedZ, z);
      feedAlong(cut, rest, z);
    }
  }
  const here = cut.builder.position;
  if (plan.core && here) {
    feedAlong(cut, [plan.core, [here[0], here[1]]], z);
  }
  const done = new Set<Front>();
  let left = plan.fronts;
  while (left.length > 0) {
    // Fronts only come after fronts of earlier steps, so one is always ready.
    const ready = left.filter((front) => front.after.every((earlier) => done.has(earlier)));
    const front = nearestFront(cut, ready, container, z, clearedZ);
    if (front.kind === "ring") {
      cutRing(cut, front.ring, front.piece, container, z, clearedZ);
    } else {
      const [start, ...rest] = front.points as [Point, ...Point[]];
      if (canStep(cut, front.piece, start, z)) {
        cut.builder.feed([start[0], start[1], z], cut.feedRate);
      } else {
        reach(cut, start, container, clearedZ);
        cut.builder.feed([start[0], start[1], z], cut.plungeRate);
      }
      feedAlong(cut, rest, z);
    }
    done.add(front);
    left = left.filter((candidate) => candidate !== front);
  }
}

/**
 * The front in `fronts` nearest to the tool at `z`: of those it reaches
 * without retracting, if any.
 */
function nearestFront(
  cut: Cut,
  fronts: Front[],
  container: Piece,
  z: number,
  clearedZ: number,
): Front {
  const here = cut.builder.position;
  let best: { front: Front; down: boolean; distance: number } | null = null;
  for (const front of fronts) {
    const start = here
      ? front.kind === "ring"
        ? projectOnLoop(front.ring.loop, [here[0], here[1]])
        : {
            point: front.points[0] as Point,
            distance: distance([here[0], here[1]], front.points[0] as Point),
          }
      : null;
    const d = start?.distance ?? 0;
    if (best?.down && d >= best.distance) continue;
    const down =
      start !== null &&
      (canStep(cut, front.piece, start.point, z) ||
        staysDown(cut, start.point, container, clearedZ));
    if (!best || (down && !best.down) || (down === best.down && d < best.distance)) {
      best = { front, down, distance: d };
    }
  }
  if (!best) throw new Error("No fronts ready");
  return best.front;
}

/** Where a front can start: anywhere along a ring, at the start of an arc. */
function startLines(front: Front): Point[][] {
  return front.kind === "ring" ? [front.ring.loop] : [[front.points[0] as Point]];
}
