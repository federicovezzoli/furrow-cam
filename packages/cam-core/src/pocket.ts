import type { PocketOperation, PocketParams, Point, Shape, Tool } from "@furrow/document";
import { DEFAULT_CHORD_TOLERANCE, flattenPath } from "./flatten";
import { difference, offset, type Polygon } from "./geometry";
import { depthLevels, plural } from "./passes";
import {
  type Cut,
  covers,
  cutRing,
  feedTrack,
  type Layout,
  loops,
  nearestFirst,
  opening,
  type Piece,
  pieces,
  polygons,
  type Ring,
  reach,
} from "./pocket-cut";
import { cutLinear, linearPlan } from "./pocket-linear";
import { cutPeel, peelArea, peelPlans } from "./pocket-peel";
import { projectOnLoop } from "./tabs";
import { type Toolpath, ToolpathBuilder, type ToolpathMove } from "./toolpath";

export type PocketOptions = {
  /** Retract height above the stock top. */
  safeZ: number;
  /** Height above the stock top where rapids down stop and feeding starts, capped at `safeZ`. */
  entryClearance: number;
  /** Chord tolerance for curves and offsets, in millimetres. */
  tolerance?: number;
};

/**
 * One pocket: the pieces its depth passes clear, the area the tool may cross
 * once they have, and the finish piece around them, if any.
 */
type Region = { pieces: Piece[]; container: Piece; finishing: Piece | null };

/**
 * The toolpath of a pocket operation (PRD-0001 R7, R20), in stock coordinates.
 *
 * - The area enclosed by the closed paths of all `shapes` is cleared, with
 *   nested rings toggling inside and outside (even-odd): a ring inside the
 *   pocket is an island left standing, a ring inside an island another pocket.
 * - Clearing stops `allowance` plus the tool radius from the walls and
 *   islands, with the params' strategy:
 *   - `offset`: rings there, then every step-over further in, cut from the
 *     centre out so the tool always has material on one side. With a
 *     step-over over half the diameter, extra rings clear what the tool
 *     centre would otherwise miss.
 *   - `linear`: a lap around every wall and island, then zig-zag passes one
 *     step-over apart at the strategy's angle (see `cutLinear`).
 *   - `peel`: the cleared area grows a step-over at a time from a starting
 *     cut, so the tool never cuts wider than the step-over after it (see
 *     `peelPlans`).
 * - Each pocket is cut to `depth` in equal passes no deeper than the tool's
 *   step-down, all passes of a pocket before the next.
 * - Climb milling keeps the material on the tool's right (clockwise spindle).
 * - The tool stays down from one ring to the next when the move stays inside
 *   the area being cut and is no longer than the tool diameter; otherwise it
 *   rises to the depth the previous pass cleared (just above the stock on the
 *   first pass) and crosses there, retracting only when the move would leave
 *   the pocket.
 * - Each ring entered from above ramps along itself at the tool's plunge
 *   angle, or plunges straight down when ramping is off, the angle is 90° or
 *   the ring is too short.
 * - A finish pass cuts the exact walls and islands at full depth, after the
 *   depth passes of every piece they enclose, moving there across the cleared
 *   floor. Necks and slots the clearing rings can't reach for the allowance
 *   get depth passes of their own, on the walls themselves.
 */
export function pocketToolpath(
  operation: PocketOperation,
  shapes: Shape[],
  options: PocketOptions,
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
    warnings.push(`Skipped ${plural(open, "open path")}: pockets need closed paths.`);
  }
  if (params.depth > tool.fluteLength) warnings.push("The depth exceeds the tool's flute length.");
  const toolpath = clearPocket(tool, params, closed, options);
  return { moves: toolpath.moves, warnings: [...warnings, ...toolpath.warnings] };
}

/**
 * The toolpath of a pocket of the area inside the rings `closed`, nested
 * rings toggling inside and outside (even-odd), as `pocketToolpath` describes.
 */
export function clearPocket(
  tool: Tool,
  params: PocketParams,
  closed: Polygon[],
  options: PocketOptions,
): Toolpath {
  const tolerance = options.tolerance ?? DEFAULT_CHORD_TOLERANCE;
  const { regions, drawn, area, warnings } = planPocket(tool, params, closed, tolerance);
  // Unless the strategy left nothing to clear, having said why.
  if (
    closed.length > 0 &&
    (area.length > 0 || drawn.length === 0) &&
    regions.every((region) => region.pieces.length === 0)
  ) {
    warnings.push("The closed paths are too small for the tool.");
  }

  const cut = pocketCut(tool, params.ramp, options);
  const levels = depthLevels(params.depth, tool.stepDown);
  for (const region of nearestFirst(cut, regions, (region) =>
    loops(region.pieces.flatMap(innermostRings)),
  )) {
    levels.forEach((z, i) => {
      cutRegionLevel(cut, region, z, levels[i - 1] ?? 0);
    });
    if (region.finishing) finishPiece(cut, region.finishing, -params.depth);
  }
  cut.builder.retract();
  return { moves: cut.builder.moves, warnings };
}

/** How a pocket's area is cleared, whatever its depth. */
export type ClearingParams = Pick<
  PocketParams,
  "strategy" | "direction" | "allowance" | "finishPass" | "ramp"
>;

/** A pocket's regions, laid out once and cut at each level. */
type PocketPlan = {
  regions: Region[];
  /** The rings cleaned up, before the strategy changes them. */
  drawn: Polygon[];
  /** The area the strategy clears. */
  area: Polygon[];
  warnings: string[];
};

function planPocket(
  tool: Tool,
  params: ClearingParams,
  closed: Polygon[],
  tolerance: number,
): PocketPlan {
  const radius = tool.diameter / 2;
  const warnings: string[] = [];
  const layout: Layout = {
    stepOver: (tool.diameter * tool.stepOver) / 100,
    radius,
    reverse: params.direction === "conventional",
    tolerance,
  };
  const offsetOptions = { arcTolerance: tolerance };
  const { strategy } = params;
  // Clean rings once, so each offset below starts from the same area.
  const drawn = offset(closed, 0, { fillRule: "evenOdd", arcTolerance: tolerance });
  const { area, warnings: skipped } =
    strategy.type === "peel" ? peelArea(drawn, strategy.start) : { area: drawn, warnings: [] };
  warnings.push(...skipped);
  const clearing = radius + params.allowance;
  let roots: Piece[];
  if (strategy.type === "offset") {
    roots = clearingTree(area, clearing, layout);
  } else {
    roots = pieces(offset(area, -clearing, offsetOptions), layout);
    if (strategy.type === "linear") {
      for (const root of roots) root.plan = linearPlan(root, strategy.angle, layout);
    } else {
      peelPlans(roots, area, strategy.start, clearing, layout);
    }
  }

  const regions: Region[] = [];
  if (params.finishPass) {
    const placed = new Set<Piece>();
    for (const wall of pieces(offset(area, -radius, offsetOptions), layout)) {
      const inside = roots.filter((root) => covers(wall, root.area.outer[0] as Point));
      for (const root of inside) placed.add(root);
      // What the clearing rings don't come within the allowance of: necks and
      // slots too narrow for them, or the whole piece when nothing fits.
      // Mitred, so the sharp corners of the walls don't count as missed.
      const reached = offset(inside.flatMap(polygons), params.allowance + tolerance, {
        ...offsetOptions,
        join: "miter",
      });
      const missed = opening(difference(polygons(wall), reached), tolerance);
      regions.push({
        pieces: [...inside, ...clearingTree(missed, 0, layout)],
        container: wall,
        finishing: wall,
      });
    }
    // Every root is inside a wall; this only guards against rounding.
    for (const root of roots) {
      if (!placed.has(root)) regions.push({ pieces: [root], container: root, finishing: null });
    }
  } else {
    for (const root of roots) regions.push({ pieces: [root], container: root, finishing: null });
  }
  return { regions, drawn, area, warnings };
}

/** What every pass of a pocket shares, `ramp` saying whether it ramps in. */
function pocketCut(tool: Tool, ramp: boolean, options: PocketOptions): Cut {
  const tolerance = options.tolerance ?? DEFAULT_CHORD_TOLERANCE;
  return {
    builder: new ToolpathBuilder(options.safeZ, options.entryClearance),
    feedRate: tool.feedRate,
    plungeRate: tool.plungeRate,
    rampRun:
      ramp && tool.plungeAngle < 90 ? 1 / Math.tan((tool.plungeAngle * Math.PI) / 180) : null,
    minRampLength: tool.diameter / 2,
    maxStep: tool.diameter + tolerance,
  };
}

/** Clears the pieces of `region` at `z`, nearest first, crossing it at `clearedZ`. */
function cutRegionLevel(cut: Cut, region: Region, z: number, clearedZ: number) {
  for (const piece of nearestFirst(cut, region.pieces, (piece) => loops(innermostRings(piece)))) {
    cutPiece(cut, piece, region.container, z, clearedZ);
  }
}

/**
 * Clears a different area at each of a series of levels, each inside the
 * one before, into one toolpath, as a pocket clears its area at each depth
 * pass: 3D roughing (PRD-0005 S5), where islands grow as the levels go down.
 * The tool may cross what the level before cleared at that level's height.
 */
export class LevelClearing {
  private readonly cut: Cut;
  private readonly tolerance: number;
  private clearedZ = 0;

  constructor(
    private readonly tool: Tool,
    private readonly params: Omit<ClearingParams, "finishPass">,
    options: PocketOptions,
  ) {
    this.tolerance = options.tolerance ?? DEFAULT_CHORD_TOLERANCE;
    this.cut = pocketCut(tool, params.ramp, options);
  }

  /**
   * Clears the area inside the rings `closed` (even-odd) at `z`, below the
   * last level. Returns the warnings of the strategy, such as a peel that
   * skips pockets.
   */
  clear(closed: Polygon[], z: number): string[] {
    const { cut, clearedZ } = this;
    const params = { ...this.params, finishPass: false };
    const { regions, warnings } = planPocket(this.tool, params, closed, this.tolerance);
    for (const region of nearestFirst(cut, regions, (region) =>
      loops(region.pieces.flatMap(innermostRings)),
    )) {
      cutRegionLevel(cut, region, z, clearedZ);
    }
    this.clearedZ = z;
    return warnings;
  }

  /** The moves so far, ending with a retract. */
  finish(): ToolpathMove[] {
    this.cut.builder.retract();
    return this.cut.builder.moves;
  }
}

/**
 * The pieces `first` in from the edges of `area`, each with the pieces every
 * step-over further in as its children, and with extra pieces for what a
 * step-over over the tool radius would leave.
 */
function clearingTree(area: Polygon[], first: number, layout: Layout): Piece[] {
  const piecesAt = (inset: number) =>
    pieces(offset(area, -inset, { arcTolerance: layout.tolerance }), layout);
  const roots = piecesAt(first);
  let level = roots;
  for (let step = 1; level.length > 0; step++) {
    const next = piecesAt(first + step * layout.stepOver);
    for (const piece of next) {
      const start = piece.area.outer[0] as Point;
      // Offset rounding may put a piece's first point just outside its parent.
      const parent = level.find((candidate) => covers(candidate, start)) ?? nearest(level, start);
      parent?.children.push(piece);
    }
    if (layout.stepOver > layout.radius) for (const piece of level) clearCentre(piece, layout);
    level = next;
  }
  return roots;
}

/** The piece whose outer boundary is nearest to `point`. */
function nearest(candidates: Piece[], point: Point): Piece | undefined {
  let best: Piece | undefined;
  let bestDistance = Infinity;
  for (const piece of candidates) {
    const outer = piece.area.outer;
    const d = projectOnLoop([...outer, outer[0] as Point], point).distance;
    if (d < bestDistance) {
      bestDistance = d;
      best = piece;
    }
  }
  return best;
}

/**
 * Gives `piece` the rings that clear what its own rings and those of its
 * children leave: everything deeper than the tool radius into the piece and
 * further than that from its children.
 */
function clearCentre(piece: Piece, layout: Layout) {
  const options = { arcTolerance: layout.tolerance };
  const inner = offset(polygons(piece), -layout.radius, options);
  if (inner.length === 0) return;
  const reached = offset(piece.children.flatMap(polygons), layout.radius, options);
  const left = opening(difference(inner, reached), layout.tolerance);
  piece.children.push(...pieces(left, layout));
}

/**
 * Clears `piece` at `z` with its plan, or for offset clearing cuts its rings
 * and everything inside it, from the centre out. The tool may cross
 * `container` at `clearedZ`.
 */
function cutPiece(cut: Cut, piece: Piece, container: Piece, z: number, clearedZ: number) {
  const { plan } = piece;
  if (plan?.kind === "linear") return cutLinear(cut, piece, plan, container, z, clearedZ);
  if (plan?.kind === "peel") return cutPeel(cut, plan, container, z, clearedZ);
  for (const child of nearestFirst(cut, piece.children, (child) => loops(innermostRings(child)))) {
    cutPiece(cut, child, container, z, clearedZ);
  }
  for (const ring of nearestFirst(cut, piece.rings, (ring) => [ring.loop])) {
    cutRing(cut, ring, piece, container, z, clearedZ);
  }
}

/** The tree never changes once built, so each piece's innermost rings are found once. */
const innermost = new WeakMap<Piece, Ring[]>();

/** The rings a tool coming to `piece` starts on. */
function innermostRings(piece: Piece): Ring[] {
  let rings = innermost.get(piece);
  if (!rings) {
    rings = piece.children.length > 0 ? piece.children.flatMap(innermostRings) : piece.rings;
    innermost.set(piece, rings);
  }
  return rings;
}

/**
 * The finish laps of `piece`'s rings at `depth`, once everything inside it is
 * cleared, each from its point nearest to the tool.
 */
function finishPiece(cut: Cut, piece: Piece, depth: number) {
  for (const ring of nearestFirst(cut, piece.rings, (ring) => [ring.loop])) {
    const here = cut.builder.position;
    const at = here ? projectOnLoop(ring.loop, [here[0], here[1]]).at : 0;
    // Across the floor; only the allowance is left anywhere in `piece`.
    reach(cut, ring.track.pointAt(at), piece, depth);
    feedTrack(cut, ring.track, at, ring.track.length, () => depth);
  }
}
