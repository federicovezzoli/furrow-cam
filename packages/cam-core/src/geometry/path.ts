import { type Path, type Point, type Segment, segmentIssue } from "@furrow/document";

/** A path of straight lines through `points`, closed around them if `closed`. */
export function polygonPath([start, ...rest]: Point[], closed = true): Path {
  const segments = rest.map((to): Segment => ({ kind: "line", to }));
  return { start: start ?? [0, 0], segments, closed };
}

/**
 * `path` without the segments that rounding left with no length, or `null`
 * if nothing is left to cut: a lone point would read as a drill position, and
 * a closed single line as nothing.
 */
export function cleanPath(path: Path): Path | null {
  const segments: Segment[] = [];
  let current = path.start;
  for (const segment of path.segments) {
    if (segmentIssue(current, segment) !== null) continue;
    segments.push(segment);
    current = segment.to;
  }
  const [only] = segments;
  if (!only || (path.closed && segments.length === 1 && only.kind === "line")) return null;
  return { ...path, segments };
}
