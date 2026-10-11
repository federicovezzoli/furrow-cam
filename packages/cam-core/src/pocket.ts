import { distance, type PocketOperation, type Point, type Shape } from "@furrow/document";
import { DEFAULT_CHORD_TOLERANCE, flattenPath } from "./flatten";
import {
  containment,
  difference,
  nest,
  offset,
  type Polygon,
  type PolygonWithHoles,
  signedArea,
} from "./geometry";
import { type Box, bounds, inBox, plural, rampZ, Track } from "./passes";
import { depthLevels, ENTRY_CLEARANCE } from "./profile";
import { projectOnLoop } from "./tabs";
import { type Toolpath, ToolpathBuilder } from "./toolpath";

export type PocketOptions = {
  /** Retract height above the stock top. */
  safeZ: number;
  /** Chord tolerance for curves and offsets, in millimetres. */
  tolerance?: number;
};

/** A closed ring the tool follows, in cutting direction, ending on its first point. */
type Ring = { loop: Point[]; track: Track };

/**
 * An area the tool centre may cover, the rings around it the tool follows
 * and the pieces inside it, which are cut before it.
 */
type Piece = { area: PolygonWithHoles; box: Box; rings: Ring[]; children: Piece[] };

/** One pocket: the outermost clearing piece and the finishing pieces around it. */
type Region = { root: Piece; finishing: Piece[] };

/** Everything the passes of one pocket share. */
type Cut = {
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
 * The toolpath of a pocket operation (PRD-0001 R7), in stock coordinates.
 *
 * - The area enclosed by the closed paths of all `shapes` is cleared, with
 *   nested rings toggling inside and outside (even-odd): a ring inside the
 *   pocket is an island left standing, a ring inside an island another pocket.
 * - Offset clearing: rings `allowance` plus the tool radius in from the walls
 *   and islands, then every step-over further in, cut from the centre out so
 *   the tool always has material on one side. With a step-over over half the
 *   diameter, extra rings clear what the tool centre would otherwise miss.
 * - Each pocket is cut to `depth` in equal passes no deeper than the tool's
 *   step-down, all passes of a pocket before the next.
 * - Climb milling keeps the material on the tool's right (clockwise spindle).
 * - The tool stays down from one ring to the next when the move stays inside
 *   the ring being cut and is no longer than the tool diameter; otherwise it
 *   rises to the depth the previous pass cleared (just above the stock on the
 *   first pass) and crosses there, retracting only when the move would leave
 *   the pocket.
 * - Each ring entered from above ramps along itself at the tool's plunge
 *   angle, or plunges straight down when ramping is off, the angle is 90° or
 *   the ring is too short.
 * - A finish pass cuts the exact walls and islands at full depth, after the
 *   depth passes of their pocket, entering from the cleared floor.
 */
export function pocketToolpath(
  operation: PocketOperation,
  shapes: Shape[],
  options: PocketOptions,
): Toolpath {
  const { tool, params } = operation;
  const tolerance = options.tolerance ?? DEFAULT_CHORD_TOLERANCE;
  const radius = tool.diameter / 2;
  const stepOver = (tool.diameter * tool.stepOver) / 100;
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
    warnings.push(`Skipped ${plural(open, "open path")}: pockets need closed paths.`);
  }
  if (params.depth > tool.fluteLength) warnings.push("The depth exceeds the tool's flute length.");

  const reverse = params.direction === "conventional";
  // Clean rings once, so each offset below starts from the same area.
  const area = offset(closed, 0, { fillRule: "evenOdd", arcTolerance: tolerance });
  const piecesAt = (inset: number) =>
    pieces(offset(area, -inset, { arcTolerance: tolerance }), reverse, tolerance);

  const roots = piecesAt(radius + params.allowance);
  let level = roots;
  for (let step = 1; level.length > 0; step++) {
    const next = piecesAt(radius + params.allowance + step * stepOver);
    for (const piece of next) {
      const parent = level.find((candidate) => covers(candidate, piece.area.outer[0] as Point));
      parent?.children.push(piece);
    }
    if (stepOver > radius) {
      for (const piece of level) clearCentre(piece, radius, reverse, tolerance);
    }
    level = next;
  }

  const regions: Region[] = roots.map((root) => ({ root, finishing: [] }));
  if (params.finishPass) {
    for (const piece of piecesAt(radius)) {
      const region = regions.find(({ root }) => covers(piece, root.area.outer[0] as Point));
      // Too narrow for anything but the finish lap: cleared as a pocket of its own.
      if (region) region.finishing.push(piece);
      else regions.push({ root: piece, finishing: [] });
    }
  }
  if (closed.length > 0 && regions.length === 0) {
    warnings.push("The closed paths are too small for the tool.");
  }

  const cut: Cut = {
    builder: new ToolpathBuilder(options.safeZ),
    feedRate: tool.feedRate,
    plungeRate: tool.plungeRate,
    rampRun:
      params.ramp && tool.plungeAngle < 90
        ? 1 / Math.tan((tool.plungeAngle * Math.PI) / 180)
        : null,
    minRampLength: radius,
    maxStep: tool.diameter + tolerance,
  };
  const levels = depthLevels(params.depth, tool.stepDown);
  for (const region of nearestFirst(cut, regions, ({ root }) => root.rings)) {
    levels.forEach((z, i) => {
      cutPiece(cut, region.root, region.root, z, levels[i - 1] ?? 0);
    });
    for (const piece of nearestFirst(cut, region.finishing, ({ rings }) => rings)) {
      finishPiece(cut, piece, region.root, -params.depth);
    }
  }
  cut.builder.retract();
  return { moves: cut.builder.moves, warnings };
}

/**
 * The pieces of offset rings `rings`: outer boundaries counter-clockwise and
 * holes clockwise, reversed for conventional milling. Rings too short to cut
 * still bound the piece's area.
 */
function pieces(rings: Polygon[], reverse: boolean, tolerance: number): Piece[] {
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
      return { area: { outer, holes }, box: bounds(outer), rings, children: [] };
    });
}

/**
 * Gives `piece` the rings that clear what its own rings and those of its
 * children leave: everything deeper than the tool radius into the piece and
 * further than that from its children.
 */
function clearCentre(piece: Piece, radius: number, reverse: boolean, tolerance: number) {
  const options = { arcTolerance: tolerance };
  const inner = offset(polygons(piece), -radius, options);
  if (inner.length === 0) return;
  const reached = offset(piece.children.flatMap(polygons), radius, options);
  // Opening by the tolerance drops slivers left by rounding.
  const left = offset(offset(difference(inner, reached), -tolerance, options), tolerance, options);
  piece.children.push(...pieces(left, reverse, tolerance));
}

function polygons({ area }: Piece): Polygon[] {
  return [area.outer, ...area.holes];
}

/** Whether `point` is in the piece's area, its boundary included. */
function covers(piece: Piece, point: Point): boolean {
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
function crossesOnlyInside(piece: Piece, a: Point, b: Point): boolean {
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

/** `items` in the order a tool starting where it is reaches them, each time going to the nearest. */
function* nearestFirst<T>(cut: Cut, items: T[], ringsOf: (item: T) => Ring[]): Generator<T> {
  const left = [...items];
  while (left.length > 0) {
    const here = cut.builder.position;
    let best = 0;
    if (here) {
      let bestDistance = Infinity;
      left.forEach((item, i) => {
        for (const { loop } of ringsOf(item)) {
          const d = projectOnLoop(loop, [here[0], here[1]]).distance;
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

/** The rings of `piece` and everything inside it, from the centre out, all at `z`. */
function cutPiece(cut: Cut, piece: Piece, root: Piece, z: number, clearedZ: number) {
  for (const child of nearestFirst(cut, piece.children, innermostRings)) {
    cutPiece(cut, child, root, z, clearedZ);
  }
  for (const ring of nearestFirst(cut, piece.rings, (ring) => [ring])) {
    cutRing(cut, ring, piece, root, z, clearedZ);
  }
}

/** The rings a tool coming to `piece` starts on. */
function innermostRings(piece: Piece): Ring[] {
  return piece.children.length > 0 ? piece.children.flatMap(innermostRings) : piece.rings;
}

/**
 * A full lap of `ring` at `z`, from its point nearest to the tool: stepping
 * over from the last ring when the tool is at `z` inside `piece` and near
 * enough, otherwise coming from above at `clearedZ` and going down along it.
 */
function cutRing(cut: Cut, ring: Ring, piece: Piece, root: Piece, z: number, clearedZ: number) {
  const { builder } = cut;
  const here = builder.position;
  let at = here ? projectOnLoop(ring.loop, [here[0], here[1]]).at : 0;
  const start = ring.track.pointAt(at);
  if (
    here &&
    Math.abs(here[2] - z) < 1e-9 &&
    distance([here[0], here[1]], start) <= cut.maxStep &&
    crossesOnlyInside(piece, [here[0], here[1]], start)
  ) {
    builder.feed([start[0], start[1], z], cut.feedRate);
  } else {
    reach(cut, start, root, clearedZ);
    at = descend(cut, ring, at, clearedZ, z);
  }
  feedTrack(cut, ring.track, at, ring.track.length, () => z);
}

/**
 * The finish laps of `piece`'s rings at `depth`, each from its point nearest
 * to the tool: across the floor when the move stays inside `piece`, otherwise
 * down through the cleared floor of `root` next to it.
 */
function finishPiece(cut: Cut, piece: Piece, root: Piece, depth: number) {
  const { builder } = cut;
  for (const ring of nearestFirst(cut, piece.rings, (ring) => [ring])) {
    const here = builder.position;
    const at = here ? projectOnLoop(ring.loop, [here[0], here[1]]).at : 0;
    const start = ring.track.pointAt(at);
    const across =
      here &&
      Math.abs(here[2] - depth) < 1e-9 &&
      crossesOnlyInside(piece, [here[0], here[1]], start);
    if (!across) {
      let slot = start;
      let nearest = Infinity;
      for (const { loop } of root.rings) {
        const projection = projectOnLoop(loop, start);
        if (projection.distance < nearest) {
          nearest = projection.distance;
          slot = projection.point;
        }
      }
      reach(cut, slot, root, depth);
    }
    builder.feed([start[0], start[1], depth], cut.feedRate);
    feedTrack(cut, ring.track, at, ring.track.length, () => depth);
  }
}

/**
 * Gets the tool to `point` at `clearedZ`, which the tool has cleared all over
 * `root`. When the tool is down in `root` and the move stays inside it, it
 * crosses at that height, or just above the stock on the first pass;
 * otherwise it goes over the top at the retract height. Either way it goes
 * down through the cleared stock.
 */
function reach(cut: Cut, point: Point, root: Piece, clearedZ: number) {
  const { builder } = cut;
  const here = builder.position;
  const clearance = Math.min(ENTRY_CLEARANCE, builder.safeZ);
  const inside =
    here && here[2] <= clearedZ + 1e-9 && crossesOnlyInside(root, [here[0], here[1]], point);
  if (here && inside && clearedZ < 0) {
    builder.feed([here[0], here[1], clearedZ], cut.feedRate);
    builder.feed([point[0], point[1], clearedZ], cut.feedRate);
    return;
  }
  if (here && inside) {
    builder.rapid([here[0], here[1], clearance]);
    builder.rapid([point[0], point[1], clearance]);
  } else {
    builder.travel(point[0], point[1]);
    builder.rapid([point[0], point[1], clearance]);
  }
  builder.feed([point[0], point[1], clearedZ], cut.plungeRate);
}

/**
 * Goes down from `from` to `z` starting `at` millimetres along `ring`:
 * ramping along it at the plunge angle, or straight down. Returns where along
 * the ring it ends.
 */
function descend(cut: Cut, ring: Ring, at: number, from: number, z: number): number {
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
function feedTrack(
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
