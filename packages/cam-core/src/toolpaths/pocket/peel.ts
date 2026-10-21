import { distance, type PeelStart, type Point } from "@furrow/document";
import {
  containmentIn,
  difference,
  intersection,
  nest,
  offset,
  type Polygon,
  signedArea,
  simplify,
} from "../../geometry/clipper";
import { flattenPath } from "../../geometry/flatten";
import { projectOnLoop } from "../../geometry/loop";
import type { ToolpathMessage } from "../messages";
import { descend, distanceToSegment, Track } from "../passes";
import {
  type Cut,
  canStep,
  covers,
  crossesOnlyInside,
  crossingAt,
  cutRing,
  feedAlong,
  feedTrack,
  type Layout,
  nearestFirst,
  opening,
  type Piece,
  pieces,
  polygons,
  type Ring,
  reach,
  staysDown,
} from "./cut";

// Peel clearing (#57): the cleared area grows a step-over at a time from a
// starting cut, and only what each step adds to its boundary is cut, so the
// tool never cuts wider than the step-over after the starting cut.

export const PEEL_ISLAND_WARNING: ToolpathMessage = { code: "toolpath.peelIsland" };

/**
 * Something to cut along the boundary of the cleared area: a whole ring, or
 * an arc from one cut stretch of the boundary to another. `piece` is the
 * cleared area it bounds, `step` the step that adds it (0 for the starting
 * cut).
 */
type Front = (
  | { kind: "ring"; ring: Ring; piece: Piece }
  | { kind: "arc"; points: Point[]; piece: Piece }
) & {
  step: number;
  /** The fronts of earlier steps that clear the area next to it, cut before it. */
  after: Front[];
};

/**
 * What a starting cut leaves standing further than the tool radius from its
 * rings: cut from `at` millimetres along `ring` to `point` and back.
 */
type Core = { ring: Ring; at: number; point: Point };

export type PeelPlan = {
  kind: "peel";
  /** The starting cut. */
  seed: Front[];
  core: Core | null;
  /** What the steps add to the cleared area's boundary, each after what it needs. */
  fronts: Front[];
  /** The area each step leaves cleared, give or take the tolerance; the first is the starting cut's. */
  cleared: Piece[][];
};

/**
 * The part of `area` peeling from `start` clears, and why the rest isn't:
 * peeling from the island needs pockets with exactly one, each disjoint
 * pocket checked on its own.
 */
export function peelArea(
  area: Polygon[],
  start: PeelStart,
): { area: Polygon[]; warnings: ToolpathMessage[] } {
  if (start !== "inside") return { area, warnings: [] };
  const pockets = nest(area);
  const kept = pockets.filter((pocket) => pocket.holes.length === 1);
  return {
    area: kept.flatMap((pocket) => [pocket.outer, ...pocket.holes]),
    warnings: kept.length < pockets.length ? [PEEL_ISLAND_WARNING] : [],
  };
}

/**
 * Gives each of `roots`, the pieces clearing `area`, its peel plan. The
 * cleared area starts as:
 * - `centre`: a circle one step-over across the point furthest from the walls
 *   and islands, or as much of it as fits;
 * - `inside`: the lap around the island of the root's pocket (`area` has
 *   exactly one island per pocket, see `peelArea`), or, for a root a neck
 *   keeps away from the island, its outer lap;
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
      const point = root.area.outer[0] as Point;
      const island = pockets.find(
        ({ outer, holes }) =>
          containmentIn(outer)(point) !== "outside" &&
          holes.every((hole) => containmentIn(hole)(point) !== "inside"),
      )?.holes[0];
      if (island) seed = islandSeed(root, island, clearing, layout);
    }
    seed ??= outerSeed(root, layout);
    const { fronts, cleared } = grow(root, seed, layout);
    root.plan = { kind: "peel", seed: seed.fronts, core: seed.core, fronts, cleared };
  }
}

/** The starting cut, the area it clears and what it leaves standing, if anything. */
type Seed = { fronts: Front[]; cleared: Polygon[]; core: Core | null };

function centreSeed(root: Piece, layout: Layout): Seed {
  const { stepOver, tolerance } = layout;
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
    fronts: piece.rings.map((ring) => ({ kind: "ring", ring, piece, step: 0, after: [] })),
    cleared: polygons(piece),
    core: coreOf(piece, layout),
  };
}

/**
 * The cut across what the rings of `piece` leave further than the tool
 * radius from them, or `null` when they leave nothing: to the point furthest
 * from them from the nearest vertex of the outer ring a straight move inside
 * `piece` reaches it from.
 */
function coreOf(piece: Piece, layout: Layout): Core | null {
  const { radius, tolerance } = layout;
  const [ring] = piece.rings;
  if (!ring || offset(polygons(piece), -radius, { arcTolerance: tolerance }).length === 0) {
    return null;
  }
  const point = furthestPoint(piece, tolerance);
  let best: { at: number; distance: number } | null = null;
  let at = 0;
  for (let i = 1; i < ring.loop.length; i++) {
    const vertex = ring.loop[i - 1] as Point;
    const d = distance(vertex, point);
    if ((!best || d < best.distance) && crossesOnlyInside(piece, vertex, point)) {
      best = { at, distance: d };
    }
    at += distance(vertex, ring.loop[i] as Point);
  }
  return best && { ring, at: best.at, point };
}

function islandSeed(root: Piece, island: Polygon, clearing: number, layout: Layout): Seed | null {
  const { tolerance } = layout;
  const zone = offset([island], clearing + tolerance, { arcTolerance: tolerance });
  // What's outside the zone counts as cut, leaving the lap around the island.
  const fronts = frontsOf(root, difference(polygons(root), zone), 0, tolerance);
  if (fronts.length === 0) return null;
  return { fronts, cleared: intersection(polygons(root), zone), core: null };
}

function outerSeed(root: Piece, layout: Layout): Seed {
  const { tolerance } = layout;
  const inner = offset([root.area.outer], -tolerance, { arcTolerance: tolerance });
  return {
    fronts: frontsOf(root, inner, 0, tolerance),
    cleared: difference(polygons(root), inner),
    core: null,
  };
}

/**
 * The fronts of each step growing the seed's cleared area by the step-over
 * inside `root`, until a step adds nothing to its boundary, and the area each
 * step leaves cleared. With a step-over over the tool radius, each step also
 * gets rings around what is further than that from both its boundary and the
 * last one, like offset clearing's centres.
 *
 * Each front comes after the fronts of earlier steps within a tool diameter
 * and a step-over of it: those clear the area the tool cuts next to, so once
 * they are cut it can be, wherever the other fronts of its step are.
 */
function grow(root: Piece, seed: Seed, layout: Layout): { fronts: Front[]; cleared: Piece[][] } {
  const { stepOver, radius, tolerance } = layout;
  const options = { arcTolerance: tolerance };
  const rootArea = polygons(root);
  const index = new FrontIndex(2 * radius + stepOver + tolerance);
  for (const front of seed.fronts) index.add(front);
  const fronts: Front[] = [];
  const place = (added: Front[]) => {
    for (const front of added) front.after = index.near(front);
    for (const front of added) index.add(front);
    fronts.push(...added);
  };
  const cleared: Piece[][] = [];
  let area = seed.cleared;
  let size = Math.abs(totalArea(area));
  for (let step = 1; ; step++) {
    const near = offset(area, tolerance, options);
    cleared.push(pieces(near, layout));
    // Simplified before it meets the walls, which stay as they are.
    const grown = simplify(offset(area, stepOver, options), tolerance / 2);
    const next = connected(intersection(grown, rootArea), near);
    const nextSize = Math.abs(totalArea(next));
    // Rounding can't grow it by a square tolerance; real growth is a step-over wide.
    if (nextSize <= size + tolerance * tolerance) break;
    const added = pieces(next, layout).flatMap((piece) => frontsOf(piece, near, step, tolerance));
    if (added.length === 0) break;
    place(added);
    if (stepOver > radius) {
      const deep = offset(next, -radius, options);
      const left = opening(difference(deep, offset(area, radius, options)), tolerance);
      place(
        pieces(left, layout).flatMap((piece) =>
          piece.rings.map((ring): Front => ({ kind: "ring", ring, piece, step, after: [] })),
        ),
      );
    }
    area = next;
    size = nextSize;
  }
  return { fronts, cleared };
}

function lineOf(front: Front): Point[] {
  return front.kind === "ring" ? front.ring.loop : front.points;
}

/**
 * The fronts placed so far, filed by grid cell so finding those near a new
 * one only looks around it: the steps' rings are nested, so their bounding
 * boxes all overlap.
 */
class FrontIndex {
  private readonly segments = new Map<string, { front: Front; a: Point; b: Point }[]>();
  private readonly points = new Map<string, { front: Front; point: Point }[]>();

  /** `reach` is how near counts as near, and the cells' size. */
  constructor(private readonly reach: number) {}

  add(front: Front) {
    const line = lineOf(front);
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1] as Point;
      const b = line[i] as Point;
      for (const key of this.cells(a, b, 0)) file(this.segments, key, { front, a, b });
    }
    for (const point of line) {
      const [x, y] = point;
      file(this.points, `${Math.floor(x / this.reach)},${Math.floor(y / this.reach)}`, {
        front,
        point,
      });
    }
  }

  /** The fronts added that come within `reach` of `front`. */
  near(front: Front): Front[] {
    const found = new Set<Front>();
    const line = lineOf(front);
    for (const point of line) {
      for (const key of this.cells(point, point, this.reach)) {
        for (const { front: other, a, b } of this.segments.get(key) ?? []) {
          if (!found.has(other) && distanceToSegment(point, a, b) <= this.reach) found.add(other);
        }
      }
    }
    // A long segment can pass near the other's points with its own ends far off.
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1] as Point;
      const b = line[i] as Point;
      for (const key of this.cells(a, b, this.reach)) {
        for (const { front: other, point } of this.points.get(key) ?? []) {
          if (!found.has(other) && distanceToSegment(point, a, b) <= this.reach) found.add(other);
        }
      }
    }
    return [...found];
  }

  /** The cells the box around `a` and `b` grown by `margin` covers. */
  private *cells(a: Point, b: Point, margin: number): Generator<string> {
    const cell = (value: number) => Math.floor(value / this.reach);
    for (
      let i = cell(Math.min(a[0], b[0]) - margin);
      i <= cell(Math.max(a[0], b[0]) + margin);
      i++
    ) {
      for (
        let j = cell(Math.min(a[1], b[1]) - margin);
        j <= cell(Math.max(a[1], b[1]) + margin);
        j++
      ) {
        yield `${i},${j}`;
      }
    }
  }
}

function file<K, T>(cells: Map<K, T[]>, key: K, item: T) {
  const cell = cells.get(key);
  if (cell) cell.push(item);
  else cells.set(key, [item]);
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
 * What of `piece`'s rings is not in `old`, as fronts of `step`: whole rings,
 * or arcs between the stretches of a ring in it. Arcs shorter than
 * `tolerance` are left out.
 */
function frontsOf(piece: Piece, old: Polygon[], step: number, tolerance: number): Front[] {
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
      fronts.push({ kind: "ring", ring, piece, step, after: [] });
      continue;
    }
    // Round the ring from an old edge, collecting the runs of new ones.
    let arc: Point[] | null = null;
    for (let k = 1; k <= n; k++) {
      const i = (first + k) % n;
      if (oldEdge[i]) {
        if (arc) fronts.push({ kind: "arc", points: arc, piece, step, after: [] });
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
        const t = crossingAt(a, b, ring[j] as Point, ring[(j + 1) % ring.length] as Point);
        if (t !== null) at.push(t);
      }
    }
    at.sort((x, y) => x - y);
    for (const t of at) result.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    result.push(b);
  }
  return result;
}

/** Whether a point is in the area of `polygons` (outer boundaries and their holes), its boundary included. */
function within(polygons: Polygon[]): (point: Point) => boolean {
  const tests = polygons.map(containmentIn);
  return (point) => {
    let inside = 0;
    for (const test of tests) {
      const result = test(point);
      // On a hole's ring counts as in it, and so in the area.
      if (result === "on") return true;
      if (result === "inside") inside++;
    }
    return inside % 2 === 1;
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

/** Where the tool is in a peel at one level: what it has cut, and what that clears. */
class Progress {
  /** The fronts whose earlier fronts are all cut. */
  readonly ready: Front[];
  /** Fronts not cut yet, by step. */
  private readonly left: number[] = [];
  private readonly waiting = new Map<Front, number>();
  private readonly dependents = new Map<Front, Front[]>();
  /** The last step whose fronts, and all before them, are cut. */
  private through = 0;

  constructor(private readonly plan: PeelPlan) {
    for (const front of plan.fronts) {
      this.left[front.step] = (this.left[front.step] ?? 0) + 1;
      // The starting cut comes first anyway.
      const pending = front.after.filter((earlier) => earlier.step > 0);
      this.waiting.set(front, pending.length);
      for (const earlier of pending) file(this.dependents, earlier, front);
    }
    this.ready = plan.fronts.filter((front) => this.waiting.get(front) === 0);
  }

  done(front: Front) {
    this.ready.splice(this.ready.indexOf(front), 1);
    for (const later of this.dependents.get(front) ?? []) {
      const pending = (this.waiting.get(later) ?? 0) - 1;
      this.waiting.set(later, pending);
      if (pending === 0) this.ready.push(later);
    }
    this.left[front.step] = (this.left[front.step] ?? 0) - 1;
    while (this.through + 1 < this.left.length && !this.left[this.through + 1]) this.through++;
  }

  /** Whether the straight move from `a` to `b` stays where every step so far is cut. */
  clearedBetween(a: Point, b: Point): boolean {
    const pieces = this.plan.cleared[this.through] ?? [];
    return pieces.some((piece) => crossesOnlyInside(piece, a, b));
  }
}

/**
 * Peels the root at `z`: the starting cut, entered like an offset ring (an
 * arc ramps back and forth along itself), the cut across a core it leaves,
 * then the fronts, each time the nearest one whose earlier fronts are cut. A
 * ring is entered like an offset ring. An arc starts on a cut stretch: the
 * tool steps over to it like to a ring, or feeds there at `z` when the move
 * stays where every earlier step is cut; otherwise it gets there through the
 * cleared depth, or over the top, and goes straight down.
 */
export function cutPeel(cut: Cut, plan: PeelPlan, container: Piece, z: number, clearedZ: number) {
  for (const front of nearestFirst(cut, plan.seed, (front) => [startOf(front)])) {
    if (front.kind === "ring") {
      cutRing(cut, front.ring, front.piece, container, z, clearedZ);
    } else {
      const [start, ...rest] = front.points as [Point, ...Point[]];
      reach(cut, start, container, clearedZ);
      descend(cut, front.points, clearedZ, z);
      feedAlong(cut, rest, z);
    }
  }
  if (plan.core) cutCore(cut, plan.core, container, z, clearedZ);

  const progress = new Progress(plan);
  while (progress.ready.length > 0) {
    const front = nearestFront(cut, progress, container, z, clearedZ);
    if (front.kind === "ring") {
      cutRing(cut, front.ring, front.piece, container, z, clearedZ);
    } else {
      const start = front.points[0] as Point;
      if (linksAtDepth(cut, progress, front.piece, start, z)) {
        cut.builder.feed([start[0], start[1], z], cut.feedRate);
      } else {
        reach(cut, start, container, clearedZ);
        cut.builder.feed([start[0], start[1], z], cut.plungeRate);
      }
      feedAlong(cut, front.points.slice(1), z);
    }
    progress.done(front);
  }
}

/** Whether the tool can feed to `start` at `z`: stepping over inside `piece`, or through what is cut. */
function linksAtDepth(
  cut: Cut,
  progress: Progress,
  piece: Piece,
  start: Point,
  z: number,
): boolean {
  const here = cut.builder.position;
  return (
    canStep(cut, piece, start, z) ||
    (here !== null &&
      Math.abs(here[2] - z) < 1e-9 &&
      progress.clearedBetween([here[0], here[1]], start))
  );
}

/** Along the starting cut's ring to where the core cut starts, there and back. */
function cutCore(cut: Cut, core: Core, container: Piece, z: number, clearedZ: number) {
  const { track, loop } = core.ring;
  const here = cut.builder.position;
  const start = track.pointAt(core.at);
  const on = here && Math.abs(here[2] - z) < 1e-9 ? projectOnLoop(loop, [here[0], here[1]]) : null;
  if (on && on.distance < 1e-6) {
    const run = (((core.at - on.at) % track.length) + track.length) % track.length;
    feedTrack(cut, track, on.at, run, () => z);
  } else {
    // Onto the ring, which this level has cut.
    reach(cut, start, container, clearedZ);
    cut.builder.feed([start[0], start[1], z], cut.plungeRate);
  }
  feedAlong(cut, [core.point, start], z);
}

/**
 * The ready front nearest to the tool at `z`: of those it reaches without
 * retracting, if any.
 */
function nearestFront(
  cut: Cut,
  progress: Progress,
  container: Piece,
  z: number,
  clearedZ: number,
): Front {
  const here = cut.builder.position;
  const at: Point | null = here && [here[0], here[1]];
  const candidates = progress.ready
    .map((front) => {
      if (!at) return { front, point: startOf(front)[0] as Point, distance: 0 };
      if (front.kind === "arc") {
        const point = front.points[0] as Point;
        return { front, point, distance: distance(at, point) };
      }
      const { point, distance: d } = projectOnLoop(front.ring.loop, at);
      return { front, point, distance: d };
    })
    .sort((a, b) => a.distance - b.distance);
  // The nearest the tool reaches without retracting, checked nearest first.
  const down = candidates.find(
    ({ front, point }) =>
      at !== null &&
      ((front.kind === "arc" && linksAtDepth(cut, progress, front.piece, point, z)) ||
        canStep(cut, front.piece, point, z) ||
        staysDown(cut, point, container, clearedZ)),
  );
  const best = down ?? candidates[0];
  if (!best) throw new Error("No fronts ready");
  return best.front;
}

/** Where a front can start: anywhere along a ring, at the start of an arc. */
function startOf(front: Front): Point[] {
  return front.kind === "ring" ? front.ring.loop : [front.points[0] as Point];
}
