import { distance, type Point, type ProfileSide, type Shape } from "@furrow/document";
import { containment } from "../geometry/clipper";
import { DEFAULT_CHORD_TOLERANCE, flattenPath } from "../geometry/flatten";
import { type Projection, projectOnLoop } from "../geometry/loop";

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
    const count = Math.max(
      1,
      Math.round("count" in placement ? placement.count : loopLength(loop) / placement.spacing),
    );
    return spreadAlong(loop, count);
  });
}

/** `count` points spread evenly along `loop`, the first half a gap from its start; none on a loop of no length. */
export function spreadAlong(loop: Point[], count: number): Point[] {
  const length = loopLength(loop);
  if (length === 0) return [];
  return Array.from({ length: count }, (_, i) => pointAlong(loop, ((i + 0.5) * length) / count));
}

/**
 * The point of `loops` (from `closedLoops`) nearest to `point`, with the
 * index of its loop, or `null` without loops. Tabs are dragged along these.
 */
export function nearestOnLoops(
  loops: Point[][],
  point: Point,
): (Projection & { loop: number }) | null {
  let best: (Projection & { loop: number }) | null = null;
  for (const [loop, points] of loops.entries()) {
    const projection = projectOnLoop(points, point);
    if (!best || projection.distance < best.distance) best = { ...projection, loop };
  }
  return best;
}

/** Where a tab's material sits: its middle and the contour's direction there, in radians. */
export type TabFrame = { center: Point; angle: number };

/** How far across a contour the side of a cut is probed. */
const SIDE_PROBE = 0.01;

/**
 * Where the tab at `position` leaves material: on the nearest of `loops`
 * (the profile's closed paths, from `closedLoops`), across the slot a tool of
 * `toolDiameter` cuts on `side` (centred on the path for `on`), or `null`
 * without loops. The tab is its width long along `angle` and `toolDiameter`
 * across.
 */
export function tabFrame(
  loops: Point[][],
  side: ProfileSide,
  position: Point,
  toolDiameter: number,
): TabFrame | null {
  const nearest = nearestOnLoops(loops, position);
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
export function closedLoops(shapes: Shape[], tolerance = DEFAULT_CHORD_TOLERANCE): Point[][] {
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

/** The stretches of a loop of `length` that the merged, ordered `spans` leave free, in order. */
export function freeSpans(spans: Span[], length: number): Span[] {
  const free: Span[] = [];
  let from = 0;
  for (const [start, end] of spans) {
    if (start > from) free.push([from, start]);
    from = Math.max(from, end);
  }
  if (from < length) free.push([from, length]);
  return free;
}

export function inSpans(spans: Span[], at: number): boolean {
  return spans.some(([from, to]) => at > from && at < to);
}
