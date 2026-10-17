import {
  distance,
  type MillingDirection,
  type Point,
  type ProfileOperation,
  type ProfileSide,
  type ProfileTabs,
  type Shape,
  type Tool,
} from "@furrow/document";
import { containment, offset, type Polygon, signedArea } from "../geometry/clipper";
import { DEFAULT_CHORD_TOLERANCE, flattenPath } from "../geometry/flatten";
import { projectOnLoop } from "../geometry/loop";
import {
  type Box,
  bounds,
  type Descent,
  depthLevels,
  descend,
  inBox,
  plural,
  rampZ,
  Track,
} from "./passes";
import { coveredSpans, freeSpans, inSpans, loopLength, pointAlong, type Span } from "./tabs";
import { type Toolpath, ToolpathBuilder } from "./toolpath";

export type ProfileOptions = {
  /** Retract height above the stock top. */
  safeZ: number;
  /** Height above the stock top where rapids down stop and feeding starts, capped at `safeZ`. */
  entryClearance: number;
  /** Chord tolerance for curves and offsets, in millimetres. */
  tolerance?: number;
};

/**
 * A closed ring the tool follows, in cutting direction, without its closing
 * point, and the stretches of it where tabs keep the tool up. It never starts
 * on a tab, and has a point at each end of one.
 */
type Contour = { ring: Point[]; wasteLeft: boolean; area: number; tabs: Span[] };

/** The contours of one offset, and where the tool centre may go without cutting the part. */
type Contours = { contours: Contour[]; isFree: (point: Point) => boolean };

/** A lead-in that doesn't fit is halved this many times before it is left out. */
const LEAD_IN_ATTEMPTS = 4;

/** Everything the passes of one profile share. */
type Cut = Descent & {
  feedRate: number;
  leadInRadius: number | null;
  /** Height the tool stays at or above over tabs, or `null` without tabs. */
  tabTop: number | null;
  tolerance: number;
  /** Contours whose lead-in had to be shortened or left out. */
  leadInMisfits: number;
};

/**
 * The toolpath of a profile operation (PRD-0001 R5), in stock coordinates.
 *
 * - `outside` keeps the area enclosed by the closed paths of all `shapes` and
 *   `inside` removes it, with nested rings toggling inside and outside (even-odd),
 *   so a part with holes is profiled outside its outline and inside its holes.
 *   `on` follows each path as drawn, open paths included.
 * - Each contour is cut to `depth` in equal passes no deeper than the tool's
 *   step-down, all passes of a contour before the next; open paths first, then
 *   smaller contours first, so inner cuts come before the outline that frees
 *   the part.
 * - Climb milling keeps the material on the tool's right (clockwise spindle).
 * - The depth passes stay `allowance` away from the contour; a finish pass then
 *   cuts the exact contour at full depth, entering from the cleared slot,
 *   right after the depth passes of that contour.
 * - Each pass enters by ramping at the tool's plunge angle (along the contour,
 *   or back and forth on the lead-in arc or an open path) or plunges straight
 *   down when ramping is off, the angle is 90° or the path is too short. A
 *   lead-in that would leave the waste side is shortened, or left out.
 * - Each tab goes to the nearest closed contour, roughing and finishing alike,
 *   where the tool centre stays at or above the tab top for the tab's width
 *   plus the tool diameter: it rises straight up at the tab's edge, crosses it
 *   flat and goes straight back down. Passes above the tab top are untouched,
 *   and no contour starts on a tab.
 */
export function profileToolpath(
  operation: ProfileOperation,
  shapes: Shape[],
  options: ProfileOptions,
): Toolpath {
  const { tool, params } = operation;
  return contourToolpath(tool, shapes, { ...params, offset: tool.diameter / 2 }, options);
}

/**
 * A cut along the paths, as profiles (R5) and engravings (R21) make it. The
 * allowance, finish pass, lead-in and tabs are off when left out.
 */
export type ContourCut = {
  side: ProfileSide;
  direction: MillingDirection;
  /** Final depth below the stock top. */
  depth: number;
  /** Ramp in at the tool's plunge angle instead of plunging straight down. */
  ramp: boolean;
  /**
   * How far the tool centre stays from the closed paths `inside` or
   * `outside`, before the allowance: the tool radius for a profile. Only the
   * contours move with it; how short a path may be ramped along and how far
   * the tool stays up over a tab go by the tool's own size.
   */
  offset: number;
  allowance?: number;
  finishPass?: boolean;
  leadIn?: { radius: number } | null;
  tabs?: ProfileTabs | null;
};

/** The toolpath of `settings` along `shapes` with `tool`, as `profileToolpath` describes. */
export function contourToolpath(
  tool: Tool,
  shapes: Shape[],
  settings: ContourCut,
  options: ProfileOptions,
): Toolpath {
  const params = { allowance: 0, finishPass: false, leadIn: null, tabs: null, ...settings };
  const { offset } = params;
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
      `Skipped ${plural(open.length, "open path")}: inside and outside cuts need closed paths.`,
    );
  }
  if (params.depth > tool.fluteLength) warnings.push("The depth exceeds the tool's flute length.");

  const cut: Cut = {
    builder: new ToolpathBuilder(options.safeZ, options.entryClearance),
    feedRate: tool.feedRate,
    plungeRate: tool.plungeRate,
    rampRun:
      params.ramp && tool.plungeAngle < 90
        ? 1 / Math.tan((tool.plungeAngle * Math.PI) / 180)
        : null,
    minRampLength: radius,
    leadInRadius: params.leadIn?.radius ?? null,
    tabTop: null,
    tolerance,
    leadInMisfits: 0,
  };
  const levels = depthLevels(params.depth, tool.stepDown);

  const roughing = contours(closed, params, offset + params.allowance);
  const finishing = params.finishPass ? contours(closed, params, offset) : null;
  if (closed.length > 0 && roughing.contours.length === 0 && !finishing?.contours.length) {
    warnings.push("The closed paths are too small for the tool.");
  }

  const { tabs } = params;
  if (tabs && tabs.positions.length > 0) {
    if (tabs.height >= params.depth) {
      warnings.push("The tabs are as tall as the cut is deep, so nothing is cut under them.");
    }
    cut.tabTop = Math.min(0, tabs.height - params.depth);
    const span = tabs.width + tool.diameter;
    const reach = offset + params.allowance + tabs.width;
    const missed = placeTabs(roughing.contours, tabs.positions, reach, span);
    const missedFinishing = finishing
      ? placeTabs(finishing.contours, tabs.positions, offset + tabs.width, span)
      : missed;
    // A tab the finish lap leaves out is cut away at full depth, so it counts as missed too.
    const left =
      roughing.contours.length === 0 ? missedFinishing : Math.max(missed, missedFinishing);
    if (left > 0) {
      warnings.push(`Left out ${plural(left, "tab")} too far from every closed contour.`);
    }
  }

  // Open paths never free the part, so they go before any closed contour.
  if (params.side === "on") for (const path of open) cutOpenPath(cut, path, levels);

  // A finish lap follows the depth passes it enters from, so inner contours
  // are finished before the outline frees the part.
  const jobs = roughing.contours.map((contour) => ({
    area: contour.area,
    run: () => cutContour(cut, contour, levels, roughing.isFree),
  }));
  if (finishing) {
    const within = params.allowance + 2 * tolerance + 1e-3;
    const boxes = roughing.contours.map((contour) => bounds(contour.ring));
    for (const contour of finishing.contours) {
      const entry = slotFor(contour.ring[0] as Point, roughing.contours, boxes, within);
      const job = entry && jobs[entry.index];
      if (entry && job) {
        const roughingRun = job.run;
        job.run = () => {
          roughingRun();
          finishContour(cut, contour, entry.point, -params.depth);
        };
      } else {
        jobs.push({
          area: contour.area,
          run: () => cutContour(cut, contour, levels, finishing.isFree),
        });
      }
    }
  }
  jobs.sort((a, b) => a.area - b.area);
  for (const job of jobs) job.run();
  cut.builder.retract();

  if (cut.leadInMisfits > 0) {
    warnings.push(
      `The lead-in didn't fit ${plural(cut.leadInMisfits, "contour")} and was shortened or left out.`,
    );
  }
  return { moves: cut.builder.moves, warnings };
}

/**
 * The rings the tool centre follows, `distance` away from the closed paths on
 * `side`, in cutting direction and cutting order.
 */
function contours(
  closed: Polygon[],
  { side, direction }: Pick<ContourCut, "side" | "direction">,
  distance: number,
): Contours {
  // Every ring here has the area it bounds on its left: the kept material for
  // `outside` and `on`, the waste for `inside`.
  const rings = (
    side === "on"
      ? closed.map((ring) => (signedArea(ring) < 0 ? [...ring].reverse() : ring))
      : offset(closed, side === "outside" ? distance : -distance, { fillRule: "evenOdd" })
  ).filter((ring) => ring.length >= 2);
  const reverse = (direction === "climb") === (side !== "inside");
  const contours = rings
    .map((ring) => ({
      ring: startOnLongestEdge(reverse ? [...ring].reverse() : ring),
      wasteLeft: (side === "inside") !== reverse,
      area: Math.abs(signedArea(ring)),
      tabs: [] as Span[],
    }))
    .sort((a, b) => a.area - b.area);

  // The rings nest without crossing, so even-odd containment gives the area they bound.
  const boxes = rings.map(bounds);
  const bounded = (point: Point) =>
    rings.filter(
      (ring, i) => inBox(point, boxes[i] as Box, 0) && containment(point, ring) === "inside",
    ).length %
      2 ===
    1;
  return { contours, isFree: side === "inside" ? bounded : (point) => !bounded(point) };
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

/**
 * Cuts a closed contour pass by pass, from the stock top down to each level.
 * `isFree` tells where a lead-in may go.
 */
function cutContour(
  cut: Cut,
  contour: Contour,
  levels: number[],
  isFree: (point: Point) => boolean,
) {
  const loop = [...contour.ring, contour.ring[0] as Point];
  const track = new Track(loop);
  if (track.length <= cut.tolerance) return;
  const { builder } = cut;

  const arc = fittingLeadIn(cut, loop, contour.wasteLeft, isFree);
  if (arc) {
    const back = [...arc].reverse();
    enter(cut, arc[0] as Point);
    let z = 0;
    for (const level of levels) {
      descend(cut, arc, z, level);
      feedAlong(cut, arc, level);
      feedTrack(cut, track, contour.tabs, 0, track.length, () => level);
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
      const from = z;
      feedTrack(cut, track, contour.tabs, at, run, (travelled) =>
        rampZ(from, level, travelled, run),
      );
      at = (at + run) % track.length;
    } else {
      // Never on a tab: without a ramp `at` stays on the contour's start.
      const point = track.pointAt(at);
      builder.feed([point[0], point[1], level], cut.plungeRate);
    }
    feedTrack(cut, track, contour.tabs, at, track.length, () => level);
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
 * depth passes cleared at `slot`, across to the contour, around it and back.
 */
function finishContour(cut: Cut, contour: Contour, slot: Point, depth: number) {
  const { builder } = cut;
  const start = contour.ring[0] as Point;
  const track = new Track([...contour.ring, start]);
  enter(cut, slot);
  builder.feed([slot[0], slot[1], depth], cut.plungeRate);
  builder.feed([start[0], start[1], depth], cut.feedRate);
  feedTrack(cut, track, contour.tabs, 0, track.length, () => depth);
  builder.feed([slot[0], slot[1], depth], cut.feedRate);
}

/**
 * The point of the `contours` nearest to `point`, with the index of its
 * contour, if one is within `within`. `boxes` are the contours' bounds.
 */
function slotFor(
  point: Point,
  contours: Contour[],
  boxes: Box[],
  within: number,
): { index: number; point: Point } | null {
  let best: { index: number; point: Point } | null = null;
  let bestDistance = within;
  contours.forEach(({ ring }, index) => {
    if (!inBox(point, boxes[index] as Box, within)) return;
    ring.forEach((a, i) => {
      const candidate = nearestOnSegment(point, a, ring[(i + 1) % ring.length] as Point);
      const d = distance(point, candidate);
      if (d <= bestDistance) {
        bestDistance = d;
        best = { index, point: candidate };
      }
    });
  });
  return best;
}

function nearestOnSegment(point: Point, a: Point, b: Point): Point {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared > 0
      ? Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / lengthSquared))
      : 0;
  return [a[0] + t * dx, a[1] + t * dy];
}

/**
 * The lead-in arc into `loop`, halved until it stays where `isFree` allows,
 * or `null` without a lead-in or when even the shortest doesn't fit.
 */
function fittingLeadIn(
  cut: Cut,
  loop: Point[],
  wasteLeft: boolean,
  isFree: (point: Point) => boolean,
): Point[] | null {
  if (cut.leadInRadius === null) return null;
  let radius = cut.leadInRadius;
  for (let attempt = 0; attempt <= LEAD_IN_ATTEMPTS; attempt++) {
    const arc = leadInArc(loop, radius, wasteLeft, cut.tolerance);
    // The last point is on the contour itself.
    if (arc.slice(0, -1).every(isFree)) {
      if (attempt > 0) cut.leadInMisfits++;
      return arc;
    }
    radius /= 2;
  }
  cut.leadInMisfits++;
  return null;
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
  builder.rapid([point[0], point[1], builder.clearance]);
  builder.feed([point[0], point[1], 0], cut.plungeRate);
}

/**
 * Feeds `run` millimetres along `track` from `at`, at height `z(travelled)`,
 * staying at or above the tab top over `tabs`: straight up at a tab's start,
 * then past its end straight down, or ramping down at the plunge angle when
 * ramping is on. Moves that go down are at the plunge rate.
 */
function feedTrack(
  cut: Cut,
  track: Track,
  tabs: Span[],
  at: number,
  run: number,
  z: (travelled: number) => number,
) {
  const { builder, tabTop } = cut;
  let previous = track.pointAt(at);
  let previousTravelled = 0;
  for (const [point, travelled] of track.walk(at, run)) {
    // Contours have a point at each end of a tab, so no step crosses one.
    const middle = (at + (previousTravelled + travelled) / 2) % track.length;
    const lifted = tabTop !== null && inSpans(tabs, middle);
    const height = (t: number) =>
      lifted && tabTop !== null
        ? Math.max(z(t), tabTop)
        : Math.max(z(t), rampDownFrom(cut, tabs, at + t, track.length));
    const from = height(previousTravelled);
    const current = builder.position?.[2];
    if (current !== undefined && Math.abs(current - from) > 1e-9) {
      builder.feed(
        [previous[0], previous[1], from],
        from < current ? cut.plungeRate : cut.feedRate,
      );
    }
    // A ramp down from a tab ends where it meets the pass's own height, part
    // way along a step: the tool reaches the pass depth there and cuts at it
    // from there on, rather than sloping down over the whole step (#153).
    if (!lifted) {
      const above = (t: number) => rampDownFrom(cut, tabs, at + t, track.length) - z(t);
      if (above(previousTravelled) > 1e-9 && above(travelled) < -1e-9) {
        let low = previousTravelled;
        let high = travelled;
        for (let i = 0; i < 60 && high - low > 1e-9; i++) {
          const middle = (low + high) / 2;
          if (above(middle) > 0) low = middle;
          else high = middle;
        }
        const [x, y] = track.pointAt(at + high);
        const meet = height(high);
        builder.feed([x, y, meet], meet < from - 1e-9 ? cut.plungeRate : cut.feedRate);
      }
    }
    const to = height(travelled);
    const last = builder.position?.[2] ?? from;
    builder.feed([point[0], point[1], to], to < last - 1e-9 ? cut.plungeRate : cut.feedRate);
    previous = point;
    previousTravelled = travelled;
  }
}

/**
 * How high the tool still is `at` millimetres along a contour of `length`
 * while ramping down after the tabs: the tab top less the descent since the
 * end of the last tab, or `-Infinity` when not ramping.
 */
function rampDownFrom(cut: Cut, tabs: Span[], at: number, length: number): number {
  const { tabTop, rampRun } = cut;
  if (tabTop === null || rampRun === null) return -Infinity;
  let height = -Infinity;
  for (const [, end] of tabs) {
    let past = (((at - end) % length) + length) % length;
    // Right on the tab's end, give or take rounding.
    if (past > length - 1e-6) past = 0;
    height = Math.max(height, tabTop - past / rampRun);
  }
  return height;
}

/**
 * Gives each of `contours` the tabs at `positions` it is nearest to, if no
 * further than `reach`, each covering `span` along it. Restarts a contour
 * that would start on a tab in the middle of the longest piece of an edge
 * that no tab covers, so a lead-in still meets a straight. Returns how many
 * positions were too far from every contour.
 */
function placeTabs(contours: Contour[], positions: Point[], reach: number, span: number): number {
  const loops = contours.map((contour) => [...contour.ring, contour.ring[0] as Point]);
  const boxes = contours.map((contour) => bounds(contour.ring));
  const centres = contours.map((): number[] => []);
  let missed = 0;
  for (const position of positions) {
    let best: { index: number; at: number; distance: number } | null = null;
    for (let index = 0; index < loops.length; index++) {
      if (!inBox(position, boxes[index] as Box, reach)) continue;
      const projection = projectOnLoop(loops[index] as Point[], position);
      if (projection.distance <= reach && (!best || projection.distance < best.distance)) {
        best = { index, at: projection.at, distance: projection.distance };
      }
    }
    if (best) centres[best.index]?.push(best.at);
    else missed++;
  }

  contours.forEach((contour, i) => {
    let at = centres[i] as number[];
    if (at.length === 0) return;
    let length = loopLength(loops[i] as Point[]);
    let tabs = coveredSpans(at, span, length);
    const first = tabs[0] as Span;
    const last = tabs.at(-1) as Span;
    const covered = first[0] <= 0 && first[1] >= length;
    if (!covered && (first[0] <= 0 || last[1] >= length)) {
      const start = freeStart(loops[i] as Point[], tabs, length);
      contour.ring = restartAt(loops[i] as Point[], start);
      at = at.map((centre) => centre - start);
      length = loopLength([...contour.ring, contour.ring[0] as Point]);
      tabs = coveredSpans(at, span, length);
    }
    contour.ring = withStops(contour.ring, tabs.flat());
    contour.tabs = tabs;
  });
  return missed;
}

/** The middle of the longest piece of an edge of closed `loop` that none of `tabs` covers. */
function freeStart(loop: Point[], tabs: Span[], length: number): number {
  const free = freeSpans(tabs, length);
  let longest = 0;
  let start = 0;
  let travelled = 0;
  for (let i = 1; i < loop.length; i++) {
    const end = travelled + distance(loop[i - 1] as Point, loop[i] as Point);
    for (const [from, to] of free) {
      const piece = Math.min(to, end) - Math.max(from, travelled);
      if (piece > longest) {
        longest = piece;
        start = Math.max(from, travelled) + piece / 2;
      }
    }
    travelled = end;
  }
  return start;
}

/** The ring of closed `loop`, starting `at` millimetres along it, without repeated points. */
function restartAt(loop: Point[], at: number): Point[] {
  const start = pointAlong(loop, at);
  let ring = loop.slice(0, -1);
  let travelled = 0;
  for (let i = 1; i < loop.length; i++) {
    travelled += distance(loop[i - 1] as Point, loop[i] as Point);
    if (travelled >= at) {
      // `loop` repeats its first point at the end; the ring doesn't.
      ring = [start, ...loop.slice(i, -1), ...loop.slice(0, i)];
      break;
    }
  }
  const distinct = ring.filter(
    (point, i) => i === 0 || distance(point, ring[i - 1] as Point) > 1e-9,
  );
  const last = distinct.at(-1) as Point;
  if (distinct.length > 1 && distance(last, distinct[0] as Point) <= 1e-9) distinct.pop();
  return distinct;
}

/** `ring` with a point added at each distance along it in `stops` that isn't one already. */
function withStops(ring: Point[], stops: number[]): Point[] {
  const sorted = [...stops].sort((a, b) => a - b);
  const result: Point[] = [];
  let travelled = 0;
  let next = 0;
  ring.forEach((a, i) => {
    const b = ring[(i + 1) % ring.length] as Point;
    const length = distance(a, b);
    result.push(a);
    while (next < sorted.length && (sorted[next] as number) <= travelled + length) {
      const stop = sorted[next] as number;
      next++;
      const f = length > 0 ? (stop - travelled) / length : 0;
      if (f > 1e-9 && f < 1 - 1e-9)
        result.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
    }
    travelled += length;
  });
  return result;
}

/** Feeds along `path` at height `z`. */
function feedAlong(cut: Cut, path: Point[], z: number) {
  for (const point of path) cut.builder.feed([point[0], point[1], z], cut.feedRate);
}
