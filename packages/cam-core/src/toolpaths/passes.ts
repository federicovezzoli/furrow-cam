import { distance, type Point } from "@furrow/document";
import type { ToolpathBuilder } from "./toolpath";

// Helpers the toolpath generators share.

/** Pass depths, as negative z: `depth` split into equal steps no deeper than `stepDown`. */
export function depthLevels(depth: number, stepDown: number): number[] {
  const count = Math.max(1, Math.ceil(depth / stepDown - 1e-9));
  return Array.from({ length: count }, (_, i) => (-depth * (i + 1)) / count);
}

export type Box = { minX: number; minY: number; maxX: number; maxY: number };

export function bounds(ring: Point[]): Box {
  const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const [x, y] of ring) {
    box.minX = Math.min(box.minX, x);
    box.minY = Math.min(box.minY, y);
    box.maxX = Math.max(box.maxX, x);
    box.maxY = Math.max(box.maxY, y);
  }
  return box;
}

/** Whether `point` is inside `box` grown by `margin`. */
export function inBox(point: Point, box: Box, margin: number): boolean {
  return (
    point[0] >= box.minX - margin &&
    point[0] <= box.maxX + margin &&
    point[1] >= box.minY - margin &&
    point[1] <= box.maxY + margin
  );
}

/** Height `travelled` along a ramp of length `total` from `z` to `level`, ending exactly on `level`. */
export function rampZ(z: number, level: number, travelled: number, total: number): number {
  return travelled >= total - 1e-9 ? level : z + ((level - z) * travelled) / total;
}

/** Distance from `point` to the segment from `a` to `b`. */
export function distanceToSegment(point: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared > 0
      ? Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / lengthSquared))
      : 0;
  return Math.hypot(a[0] + t * dx - point[0], a[1] + t * dy - point[1]);
}

/** How a generator goes down into the stock. */
export type Descent = {
  builder: ToolpathBuilder;
  plungeRate: number;
  /** Horizontal travel per millimetre of descent when ramping, or `null` to plunge. */
  rampRun: number | null;
  /** Ramps along anything shorter than this plunge instead. */
  minRampLength: number;
};

/**
 * Gets from `z` down to `level` at `path[0]`: ramping back and forth along
 * `path` as many times as the plunge angle needs, or straight down.
 */
export function descend(cut: Descent, path: Point[], z: number, level: number) {
  const start = path[0] as Point;
  const track = new Track(path);
  if (cut.rampRun === null || track.length < cut.minRampLength) {
    cut.builder.feed([start[0], start[1], level], cut.plungeRate);
    return;
  }
  const run = (z - level) * cut.rampRun;
  // Go no further along the path than one trip there and back needs.
  const reach = Math.min(track.length, run / 2);
  const there = [...track.walk(0, reach)].map(([point]) => point);
  const back = [...there].reverse().slice(1);
  back.push(start);
  const trips = Math.ceil(run / (2 * reach));
  const total = 2 * trips * reach;
  let travelled = 0;
  let previous = start;
  for (let i = 0; i < trips; i++) {
    for (const point of [...there, ...back]) {
      travelled += distance(previous, point);
      previous = point;
      cut.builder.feed([point[0], point[1], rampZ(z, level, travelled, total)], cut.plungeRate);
    }
  }
}

/** A polyline measured by length; a closed one repeats its first point at the end. */
export class Track {
  readonly length: number;
  private readonly cumulative: number[];

  constructor(private readonly points: Point[]) {
    this.cumulative = [0];
    for (let i = 1; i < points.length; i++) {
      const previous = this.cumulative[i - 1] as number;
      this.cumulative.push(previous + distance(points[i - 1] as Point, points[i] as Point));
    }
    this.length = this.cumulative.at(-1) ?? 0;
  }

  /**
   * The point `at` millimetres from the start, wrapping around a closed track.
   * `length` along is the last point, which on an open track is not the first.
   */
  pointAt(at: number): Point {
    const d = at >= 0 && at <= this.length ? at : ((at % this.length) + this.length) % this.length;
    let i = 1;
    while (i < this.points.length - 1 && (this.cumulative[i] as number) < d) i++;
    const a = this.points[i - 1] as Point;
    const b = this.points[i] as Point;
    const from = this.cumulative[i - 1] as number;
    const span = (this.cumulative[i] as number) - from;
    const f = span > 0 ? (d - from) / span : 0;
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
  }

  /**
   * The points met going `run` millimetres forward from `at`, each with the
   * distance travelled to it, ending exactly `run` along. Wraps around a closed
   * track; on an open one `at + run` must not pass the end.
   */
  *walk(at: number, run: number): Generator<[Point, number]> {
    const end = at + run;
    let lap = Math.floor(at / this.length) * this.length;
    while (lap < end) {
      for (let i = 1; i < this.points.length; i++) {
        const position = lap + (this.cumulative[i] as number);
        if (position >= end) break;
        if (position > at) yield [this.points[i] as Point, position - at];
      }
      lap += this.length;
    }
    yield [this.pointAt(end), run];
  }
}

export function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
