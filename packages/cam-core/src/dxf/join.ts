import {
  distance,
  GEOMETRY_TOLERANCE,
  type Path,
  type Point,
  pointsCoincide,
  type Segment,
} from "@furrow/document";

/** A joined path and the indices, in `paths`, of the paths it was made from. */
export type Chain = { path: Path; parts: number[] };

/** A chain with the smallest index among its parts, to put chains in drawing order. */
type Ordered = Chain & { order: number };

/** One end of a path: `end` 0 is its start, 1 its last point. */
type End = { path: number; end: 0 | 1 };

/**
 * Joins open paths whose ends coincide (`pointsCoincide`) into longer ones,
 * reversing them as needed. Two ends are joined only when no third end
 * coincides with either, so branching points are left alone. A chain that
 * comes back to where it started is closed, including a single path whose
 * ends meet. Chains are returned in the order of their first path.
 */
export function joinPaths(paths: Path[]): Chain[] {
  const ends: Point[][] = paths.map((path) => [path.start, lastPoint(path)]);
  const grid = new Map<string, End[]>();
  const cellOf = ([x, y]: Point): [number, number] => [
    Math.floor(x / GEOMETRY_TOLERANCE),
    Math.floor(y / GEOMETRY_TOLERANCE),
  ];
  paths.forEach((_, path) => {
    for (const end of [0, 1] as const) {
      const [cx, cy] = cellOf(ends[path]?.[end] as Point);
      const key = `${cx},${cy}`;
      const cell = grid.get(key);
      if (cell) cell.push({ path, end });
      else grid.set(key, [{ path, end }]);
    }
  });

  /** The ends coinciding with `of`, itself included, up to three: more can't be joined either. */
  function near(of: End): End[] {
    const point = ends[of.path]?.[of.end] as Point;
    const [cx, cy] = cellOf(point);
    const found: End[] = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const other of grid.get(`${cx + dx},${cy + dy}`) ?? []) {
          if (!pointsCoincide(point, ends[other.path]?.[other.end] as Point)) continue;
          found.push(other);
          if (found.length > 2) return found;
        }
      }
    }
    return found;
  }

  /** `links[path][end]`: the end it is joined to, if any. */
  const links: (End | null)[][] = paths.map(() => [null, null]);
  paths.forEach((_, path) => {
    for (const end of [0, 1] as const) {
      const around = near({ path, end });
      if (around.length !== 2) continue;
      const other = around.find((e) => e.path !== path || e.end !== end) as End;
      const back = near(other);
      if (back.length === 2 && back.some((e) => e.path === path && e.end === end)) {
        (links[path] as (End | null)[])[end] = other;
      }
    }
  });

  const used = new Set<number>();
  const chains: Ordered[] = [];

  /** Follows links from `path`, entered at `entry`, until a free end or back to `first`. */
  function walk(first: number, entry: 0 | 1): Ordered {
    const parts: number[] = [];
    let built: Path | null = null;
    let path = first;
    let at = entry;
    let closed = false;
    for (;;) {
      used.add(path);
      parts.push(path);
      const piece = at === 0 ? (paths[path] as Path) : reversePath(paths[path] as Path);
      built = built ? append(built, piece) : { ...piece, segments: [...piece.segments] };
      const exit = (1 - at) as 0 | 1;
      const next = links[path]?.[exit];
      if (!next) break;
      if (next.path === first && next.end === entry) {
        closed = true;
        break;
      }
      if (used.has(next.path)) break;
      path = next.path;
      at = next.end;
    }
    const path0 = built as Path;
    const [only] = path0.segments;
    const single = path0.segments.length === 1 && only?.kind === "line";
    let order = first;
    // A loop, not a spread: a chain can have as many parts as the drawing has entities.
    for (const part of parts) if (part < order) order = part;
    return {
      path: { ...path0, closed: closed && path0.segments.length > 0 && !single },
      parts,
      order,
    };
  }

  // Chains with a free end first, from that end; what is left are loops.
  paths.forEach((_, path) => {
    if (used.has(path)) return;
    const [startLink, endLink] = links[path] as (End | null)[];
    if (!startLink) chains.push(walk(path, 0));
    else if (!endLink) chains.push(walk(path, 1));
  });
  paths.forEach((_, path) => {
    if (!used.has(path)) chains.push(walk(path, 0));
  });
  chains.sort((a, b) => a.order - b.order);
  return chains.map(({ path, parts }) => ({ path, parts }));
}

function lastPoint(path: Path): Point {
  return path.segments.at(-1)?.to ?? path.start;
}

/** `path` traced the other way. */
export function reversePath(path: Path): Path {
  const points = [path.start, ...path.segments.map((segment) => segment.to)];
  const segments: Segment[] = [];
  for (let i = path.segments.length - 1; i >= 0; i--) {
    const segment = path.segments[i] as Segment;
    const to = points[i] as Point;
    if (segment.kind === "line") segments.push({ kind: "line", to });
    else if (segment.kind === "cubic")
      segments.push({ kind: "cubic", c1: segment.c2, c2: segment.c1, to });
    else segments.push({ kind: "arc", to, center: segment.center, clockwise: !segment.clockwise });
  }
  return { start: lastPoint(path), segments, closed: path.closed };
}

/**
 * `piece` appended to `path`, from where `path` ends, which coincides with
 * `piece`'s start. Segments that become zero-length there are dropped.
 */
function append(path: Path, piece: Path): Path {
  const segments = path.segments;
  let current = lastPoint(path);
  for (const segment of piece.segments) {
    if (segment.kind === "line" && pointsCoincide(current, segment.to)) continue;
    if (
      segment.kind === "cubic" &&
      [segment.c1, segment.c2, segment.to].every((p) => pointsCoincide(current, p))
    ) {
      continue;
    }
    if (segment.kind === "arc") {
      // An open path has no full circles, so an arc ending where it starts is too short to keep.
      if (pointsCoincide(current, segment.to)) continue;
      const radius = distance(segment.center, segment.to);
      if (Math.abs(distance(segment.center, current) - radius) > GEOMETRY_TOLERANCE) {
        // Only possible when the ends were almost exactly the tolerance apart: keep the path valid.
        segments.push({ kind: "line", to: segment.to });
        current = segment.to;
        continue;
      }
    }
    segments.push(segment);
    current = segment.to;
  }
  return path;
}
