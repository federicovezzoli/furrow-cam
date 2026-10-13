import { distance, type Point } from "@furrow/document";
import {
  containment,
  nest,
  offset,
  type Polygon,
  type PolygonWithHoles,
  signedArea,
} from "./geometry";
import { type Box, bounds, inBox, rampZ, Track } from "./passes";
import type { LinearPlan } from "./pocket-linear";
import type { PeelPlan } from "./pocket-peel";
import { projectOnLoop } from "./tabs";
import type { ToolpathBuilder } from "./toolpath";

// What the pocket strategies share: the pieces they clear and the moves
// between and into them.

/** A closed ring the tool follows, in cutting direction, ending on its first point. */
export type Ring = { loop: Point[]; track: Track };

/**
 * An area the tool centre may cover and the rings around it the tool follows.
 * Offset clearing cuts the pieces inside it, its children, before it; the
 * other strategies clear it with a plan of their own.
 */
export type Piece = {
  area: PolygonWithHoles;
  box: Box;
  rings: Ring[];
  children: Piece[];
  plan: LinearPlan | PeelPlan | null;
};

/** How a pocket's rings are laid out. */
export type Layout = { stepOver: number; radius: number; reverse: boolean; tolerance: number };

/** Everything the passes of one pocket share. */
export type Cut = {
  builder: ToolpathBuilder;
  feedRate: number;
  plungeRate: number;
  /** Horizontal travel per millimetre of descent when ramping, or `null` to plunge. */
  rampRun: number | null;
  /** Ramps along anything shorter than this plunge instead. */
  minRampLength: number;
  /** Longest move from one ring to the next that stays down. */
  maxStep: number;
};

/**
 * The pieces of offset rings `rings`: outer boundaries counter-clockwise and
 * holes clockwise, reversed for conventional milling. Rings too short to cut
 * still bound the piece's area.
 */
export function pieces(rings: Polygon[], { reverse, tolerance }: Layout): Piece[] {
  return nest(rings)
    .filter(({ outer }) => outer.length >= 3)
    .map((area) => {
      const outer = signedArea(area.outer) < 0 ? [...area.outer].reverse() : area.outer;
      const holes = area.holes.map((hole) => (signedArea(hole) > 0 ? [...hole].reverse() : hole));
      const rings = [outer, ...holes]
        .map((ring) => (reverse ? [...ring].reverse() : ring))
        .map((ring) => {
          const loop = [...ring, ring[0] as Point];
          return { loop, track: new Track(loop) };
        })
        .filter(({ track }) => track.length > tolerance);
      return { area: { outer, holes }, box: bounds(outer), rings, children: [], plan: null };
    });
}

/** `polygons` less the slivers rounding leaves, narrower than twice `tolerance`. */
export function opening(polygons: Polygon[], tolerance: number): Polygon[] {
  const options = { arcTolerance: tolerance };
  return offset(offset(polygons, -tolerance, options), tolerance, options);
}

export function polygons({ area }: Piece): Polygon[] {
  return [area.outer, ...area.holes];
}

/** Whether `point` is in the piece's area, its boundary included. */
export function covers(piece: Piece, point: Point): boolean {
  return (
    inBox(point, piece.box, 0) &&
    containment(point, piece.area.outer) !== "outside" &&
    piece.area.holes.every((hole) => containment(point, hole) !== "inside")
  );
}

/**
 * Whether the straight move from `a` to `b` stays in the piece's area: it
 * crosses none of its rings and the points along it are inside.
 */
export function crossesOnlyInside(piece: Piece, a: Point, b: Point): boolean {
  for (const ring of polygons(piece)) {
    for (let i = 0; i < ring.length; i++) {
      if (crosses(a, b, ring[i] as Point, ring[(i + 1) % ring.length] as Point)) return false;
    }
  }
  return [0.25, 0.5, 0.75].every((t) =>
    covers(piece, [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]),
  );
}

/**
 * Whether segments `ab` and `cd` cross at a point inside both. Ends within
 * rounding of the other segment, like a move to a point on a ring, touch it
 * without crossing.
 */
function crosses(a: Point, b: Point, c: Point, d: Point): boolean {
  const side = (p: Point, q: Point, r: Point) => {
    const length = distance(p, q);
    if (length === 0) return 0;
    const offLine = ((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])) / length;
    return Math.abs(offLine) < 1e-6 ? 0 : Math.sign(offLine);
  };
  return side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0;
}

/**
 * `items` in the order a tool starting where it is reaches them, each time
 * going to the nearest of the polylines `linesOf` gives.
 */
export function* nearestFirst<T>(
  cut: Cut,
  items: T[],
  linesOf: (item: T) => Point[][],
): Generator<T> {
  const left = [...items];
  while (left.length > 0) {
    const here = cut.builder.position;
    let best = 0;
    if (here) {
      let bestDistance = Infinity;
      left.forEach((item, i) => {
        for (const line of linesOf(item)) {
          const d = projectOnLoop(line, [here[0], here[1]]).distance;
          if (d < bestDistance) {
            bestDistance = d;
            best = i;
          }
        }
      });
    }
    yield left.splice(best, 1)[0] as T;
  }
}

/** The loops of `rings`, for `nearestFirst`. */
export function loops(rings: Ring[]): Point[][] {
  return rings.map((ring) => ring.loop);
}

/**
 * Whether the tool, where it is, can feed straight to `point` at `z`: it is
 * at `z`, no further than a step away, and the move stays inside `piece`.
 */
export function canStep(cut: Cut, piece: Piece, point: Point, z: number): boolean {
  const here = cut.builder.position;
  return (
    here !== null &&
    Math.abs(here[2] - z) < 1e-9 &&
    distance([here[0], here[1]], point) <= cut.maxStep &&
    crossesOnlyInside(piece, [here[0], here[1]], point)
  );
}

/**
 * A full lap of `ring` at `z`, from its point nearest to the tool: stepping
 * over from the last ring when the tool is at `z` inside `piece` and near
 * enough, otherwise coming from above at `clearedZ` and going down along it.
 */
export function cutRing(
  cut: Cut,
  ring: Ring,
  piece: Piece,
  container: Piece,
  z: number,
  clearedZ: number,
) {
  const here = cut.builder.position;
  let at = here ? projectOnLoop(ring.loop, [here[0], here[1]]).at : 0;
  const start = ring.track.pointAt(at);
  if (canStep(cut, piece, start, z)) {
    cut.builder.feed([start[0], start[1], z], cut.feedRate);
  } else {
    reach(cut, start, container, clearedZ);
    at = descendRing(cut, ring, at, clearedZ, z);
  }
  feedTrack(cut, ring.track, at, ring.track.length, () => z);
}

/**
 * Gets the tool to `point` at `clearedZ`, which the tool has cleared all over
 * `container`. When the tool is down in `container`, below the stock top, and
 * the move stays inside it, it crosses at that height; otherwise it goes over
 * the top at the retract height, since the entry clearance may be too close to
 * uncut stock to cross it. Either way it goes down through the cleared stock.
 */
export function reach(cut: Cut, point: Point, container: Piece, clearedZ: number) {
  const { builder } = cut;
  const here = builder.position;
  if (here && staysDown(cut, point, container, clearedZ)) {
    builder.feed([here[0], here[1], clearedZ], cut.feedRate);
    builder.feed([point[0], point[1], clearedZ], cut.feedRate);
    return;
  }
  builder.travel(point[0], point[1]);
  builder.rapid([point[0], point[1], builder.clearance]);
  builder.feed([point[0], point[1], clearedZ], cut.plungeRate);
}

/** Whether `reach` gets to `point` without retracting: through `container` at `clearedZ`. */
export function staysDown(cut: Cut, point: Point, container: Piece, clearedZ: number): boolean {
  const here = cut.builder.position;
  return (
    here !== null &&
    clearedZ < 0 &&
    here[2] <= clearedZ + 1e-9 &&
    crossesOnlyInside(container, [here[0], here[1]], point)
  );
}

/**
 * Goes down from `from` to `z` starting `at` millimetres along `ring`:
 * ramping along it at the plunge angle, or straight down. Returns where along
 * the ring it ends.
 */
export function descendRing(cut: Cut, ring: Ring, at: number, from: number, z: number): number {
  const { track } = ring;
  if (cut.rampRun === null || track.length < cut.minRampLength) {
    const point = track.pointAt(at);
    cut.builder.feed([point[0], point[1], z], cut.plungeRate);
    return at;
  }
  const run = (from - z) * cut.rampRun;
  feedTrack(cut, track, at, run, (travelled) => rampZ(from, z, travelled, run));
  return (at + run) % track.length;
}

/** Feeds `run` millimetres along `track` from `at`, at height `z(travelled)`; moves that go down are at the plunge rate. */
export function feedTrack(
  cut: Cut,
  track: Track,
  at: number,
  run: number,
  z: (travelled: number) => number,
) {
  const { builder } = cut;
  for (const [point, travelled] of track.walk(at, run)) {
    const height = z(travelled);
    const current = builder.position?.[2] ?? height;
    builder.feed(
      [point[0], point[1], height],
      height < current - 1e-9 ? cut.plungeRate : cut.feedRate,
    );
  }
}

/** Feeds along `points` at `z`. */
export function feedAlong(cut: Cut, points: Point[], z: number) {
  for (const point of points) cut.builder.feed([point[0], point[1], z], cut.feedRate);
}
