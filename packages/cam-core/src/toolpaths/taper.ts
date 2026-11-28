import { distance, type EngraveTaper, type Point } from "@furrow/document";

/** An open path with the final depth below the stock top at each of its points. */
export type TaperedPath = { points: Point[]; depths: number[] };

/**
 * `path` with the depth of a fluted engraving (#555) at each point: from the
 * stock top at its first point down to `depth` over `taper.start`
 * millimetres, and back up over `taper.end` to its last, peaking where the
 * two ramps meet when they overlap. Points are added where the depth changes
 * slope and where it crosses each of the `levels` (negative, as
 * `depthLevels` gives them), so a straight move between two points follows
 * the depth exactly, whatever pass it is cut in.
 */
export function taperPath(
  path: Point[],
  depth: number,
  taper: EngraveTaper,
  levels: number[],
): TaperedPath {
  const cumulative = [0];
  for (let i = 1; i < path.length; i++) {
    const before = cumulative[i - 1] as number;
    cumulative.push(before + distance(path[i - 1] as Point, path[i] as Point));
  }
  const length = cumulative.at(-1) ?? 0;
  const { start, end } = taper;
  const depthAt = (at: number) =>
    depth * Math.min(1, start > 0 ? at / start : 1, end > 0 ? (length - at) / end : 1);
  const fractions = [1, ...levels.map((level) => -level / depth)];
  const breaks = fractions.flatMap((fraction) => [fraction * start, length - fraction * end]);
  if (start + end > length) breaks.push((length * start) / (start + end));
  const sorted = breaks
    .filter((at) => at > 0 && at < length)
    .sort((a, b) => a - b)
    .filter((at, i, all) => i === 0 || at - (all[i - 1] as number) > 1e-9);

  const points: Point[] = [path[0] as Point];
  const depths = [depthAt(0)];
  let next = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1] as Point;
    const b = path[i] as Point;
    const from = cumulative[i - 1] as number;
    const to = cumulative[i] as number;
    for (; next < sorted.length && (sorted[next] as number) < to; next++) {
      const at = sorted[next] as number;
      // Already a point of the path.
      if (at - from <= 1e-9 || to - at <= 1e-9) continue;
      const t = (at - from) / (to - from);
      points.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      depths.push(depthAt(at));
    }
    points.push(b);
    depths.push(depthAt(to));
  }
  return { points, depths };
}
