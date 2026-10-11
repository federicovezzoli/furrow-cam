import { distance, type Point, type ProfileSide, type Shape } from "@furrow/document";
import { DEFAULT_CHORD_TOLERANCE, flattenPath } from "./flatten";
import { containment } from "./geometry";

/** How "Auto place" spreads tabs: a number per contour, or one every `spacing` millimetres. */
export type TabPlacement = { count: number } | { spacing: number };

/**
 * Tab positions spread evenly along the closed paths of `shapes` that a
 * profile on `side` frees a piece with: the outlines (even nesting depth) of
 * an outside profile, every closed path otherwise. Each contour gets `count`
 * tabs, or its length over `spacing` rounded, at least one, starting half a
 * gap from the path's start so a rectangle drawn from a corner gets them
 * mid-side.
 */
export function autoTabPositions(
  shapes: Shape[],
  side: ProfileSide,
  placement: TabPlacement,
  tolerance = DEFAULT_CHORD_TOLERANCE,
): Point[] {
  const loops = closedLoops(shapes, tolerance);
  const freeing =
    side === "outside" ? loops.filter((loop) => nestingDepth(loop, loops) % 2 === 0) : loops;
  return freeing.flatMap((loop) => {
    const length = loopLength(loop);
    if (length === 0) return [];
    const count = Math.max(
      1,
      Math.round("count" in placement ? placement.count : length / placement.spacing),
    );
    return Array.from({ length: count }, (_, i) => pointAlong(loop, ((i + 0.5) * length) / count));
  });
}

/**
 * The point of the closed paths of `shapes` nearest to `point`, and how far
 * it is, or `null` if they have none. Tabs are dragged along these.
 */
export function nearestOnClosedPaths(
  shapes: Shape[],
  point: Point,
  tolerance = DEFAULT_CHORD_TOLERANCE,
): Projection | null {
  let best: Projection | null = null;
  for (const loop of closedLoops(shapes, tolerance)) {
    const projection = projectOnLoop(loop, point);
    if (!best || projection.distance < best.distance) best = projection;
  }
  return best;
}

/** Where a tab's material sits: its middle and the contour's direction there, in radians. */
export type TabFrame = { center: Point; angle: number };

/** How far across a contour the side of a cut is probed. */
const SIDE_PROBE = 0.01;

/**
 * Where the tab at `position` leaves material: on the nearest closed path of
 * `shapes`, across the slot a tool of `toolDiameter` cuts on `side` (centred
 * on the path for `on`), or `null` without closed paths. The tab is its
 * width long along `angle` and `toolDiameter` across.
 */
export function tabFrame(
  shapes: Shape[],
  side: ProfileSide,
  position: Point,
  toolDiameter: number,
  tolerance = DEFAULT_CHORD_TOLERANCE,
): TabFrame | null {
  const loops = closedLoops(shapes, tolerance);
  let nearest: Projection | null = null;
  for (const loop of loops) {
    const projection = projectOnLoop(loop, position);
    if (!nearest || projection.distance < nearest.distance) nearest = projection;
  }
  if (!nearest) return null;
  const { point, tangent } = nearest;
  const angle = Math.atan2(tangent[1], tangent[0]);
  if (side === "on") return { center: point, angle };
  // Left of the path's direction; the area the closed paths bound is even-odd.
  const left: Point = [-tangent[1], tangent[0]];
  const probe: Point = [point[0] + left[0] * SIDE_PROBE, point[1] + left[1] * SIDE_PROBE];
  const enclosed = loops.filter((loop) => containment(probe, loop) === "inside").length % 2 === 1;
  // Outside profiles cut outside the area, inside profiles inside it.
  const towards = enclosed === (side === "inside") ? 1 : -1;
  const offset = (towards * toolDiameter) / 2;
  return { center: [point[0] + left[0] * offset, point[1] + left[1] * offset], angle };
}

/** The closed paths of `shapes`, flattened, each ending on its first point. */
function closedLoops(shapes: Shape[], tolerance: number): Point[][] {
  return shapes.flatMap((shape) =>
    shape.paths
      .filter((path) => path.closed && path.segments.length > 0)
      .map((path) => flattenPath(path, tolerance)),
  );
}

/** How many of the other `loops` enclose `loop`. */
function nestingDepth(loop: Point[], loops: Point[][]): number {
  const probe = loop[0] as Point;
  return loops.filter((other) => other !== loop && containment(probe, other) === "inside").length;
}

export function loopLength(loop: Point[]): number {
  let length = 0;
  for (let i = 1; i < loop.length; i++) length += distance(loop[i - 1] as Point, loop[i] as Point);
  return length;
}

/** The point `at` millimetres along `loop`, clamped to its ends. */
export function pointAlong(loop: Point[], at: number): Point {
  let travelled = 0;
  for (let i = 1; i < loop.length; i++) {
    const a = loop[i - 1] as Point;
    const b = loop[i] as Point;
    const length = distance(a, b);
    if (travelled + length >= at && length > 0) {
      const f = Math.max(0, (at - travelled) / length);
      return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
    }
    travelled += length;
  }
  return loop.at(-1) as Point;
}

/** The nearest point of a loop: where it is, how far along and away, and the loop's direction there. */
export type Projection = { point: Point; at: number; distance: number; tangent: Point };

/** The point of `loop` nearest to `point`. */
export function projectOnLoop(loop: Point[], point: Point): Projection {
  let best: Projection | null = null;
  let travelled = 0;
  for (let i = 1; i < loop.length; i++) {
    const a = loop[i - 1] as Point;
    const b = loop[i] as Point;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const lengthSquared = dx * dx + dy * dy;
    const t =
      lengthSquared > 0
        ? Math.max(
            0,
            Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / lengthSquared),
          )
        : 0;
    const candidate: Point = [a[0] + t * dx, a[1] + t * dy];
    const d = distance(point, candidate);
    const length = Math.sqrt(lengthSquared);
    if (length > 0 && (!best || d < best.distance)) {
      const tangent: Point = [dx / length, dy / length];
      best = { point: candidate, at: travelled + t * length, distance: d, tangent };
    }
    travelled += length;
  }
  return (
    best ?? {
      point: loop[0] as Point,
      at: 0,
      distance: distance(point, loop[0] as Point),
      tangent: [1, 0],
    }
  );
}

/** A stretch of a closed loop by distance along it, `[from, to]` within `[0, length]`. */
export type Span = [number, number];

/**
 * The stretches of a loop of `length` that `width`-long spans centred at
 * `centres` cover, merged and in order. A span crossing the loop's start is
 * split in two.
 */
export function coveredSpans(centres: number[], width: number, length: number): Span[] {
  if (centres.length === 0) return [];
  if (width >= length) return [[0, length]];
  const pieces: Span[] = [];
  for (const centre of centres) {
    const c = ((centre % length) + length) % length;
    const from = c - width / 2;
    const to = c + width / 2;
    if (from < 0) pieces.push([from + length, length], [0, to]);
    else if (to > length) pieces.push([from, length], [0, to - length]);
    else pieces.push([from, to]);
  }
  pieces.sort((a, b) => a[0] - b[0]);
  const merged: Span[] = [];
  for (const piece of pieces) {
    const last = merged.at(-1);
    if (last && piece[0] <= last[1]) last[1] = Math.max(last[1], piece[1]);
    else merged.push([piece[0], piece[1]]);
  }
  return merged;
}

/** The middle of the longest stretch of a loop of `length` that no span covers, or `null` if none is free. */
export function longestGapMiddle(spans: Span[], length: number): number | null {
  if (spans.length === 0) return 0;
  let bestSize = 1e-9;
  let middle: number | null = null;
  for (let i = 0; i < spans.length; i++) {
    const span = spans[i] as Span;
    const next = spans[(i + 1) % spans.length] as Span;
    const end = i + 1 < spans.length ? next[0] : next[0] + length;
    const size = end - span[1];
    if (size > bestSize) {
      bestSize = size;
      middle = (span[1] + size / 2) % length;
    }
  }
  return middle;
}

export function inSpans(spans: Span[], at: number): boolean {
  return spans.some(([from, to]) => at > from && at < to);
}
