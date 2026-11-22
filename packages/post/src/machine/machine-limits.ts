import type { Vec3 } from "@furrow/cam-core";
import type { Machine } from "@furrow/document";

/**
 * The fastest a feed from `from` to `to` may go: neither its XY nor its Z
 * component may exceed the machine's maximum.
 */
export function limitFeed(from: Vec3, to: Vec3, feedRate: number, machine: Machine | null) {
  if (machine === null) return feedRate;
  const { maxFeedXY, maxFeedZ } = machine;
  const xy = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const z = Math.abs(to[2] - from[2]);
  const length = Math.hypot(xy, z);
  let limit = feedRate;
  if (xy > 0) limit = Math.min(limit, (maxFeedXY * length) / xy);
  if (z > 0) limit = Math.min(limit, (maxFeedZ * length) / z);
  // Rounded down, so the written feed never exceeds the limit.
  return limit < feedRate ? Math.floor(limit * 1000) / 1000 : feedRate;
}

/** The `S` value for `rpm`, kept in the machine's range; `null` for a manual spindle. */
export function spindleSpeed(rpm: number, machine: Machine | null) {
  if (machine === null) return { value: rpm, clamped: false };
  const { spindleRpmMin: min, spindleRpmMax: max } = machine;
  if (min === null || max === null) return { value: null, clamped: false };
  const value = Math.min(Math.max(rpm, min), max);
  return { value, clamped: value !== rpm };
}
