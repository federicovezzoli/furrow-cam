import { GEOMETRY_TOLERANCE } from "@furrow/document";
import type { Toolpath } from "../toolpaths/toolpath";

/**
 * A toolpath as typed arrays for the viewport (ADR-0008), built in the worker
 * that computes it and transferred without copying. `feeds`, `rapids` and
 * `holes` are `LineSegments` positions in stock coordinates: `[x, y, z]` per
 * vertex, two vertices per segment. The first move has no start, so it has no
 * segment.
 */
export type ToolpathLines = {
  feeds: Float32Array;
  rapids: Float32Array;
  /**
   * The distance along its own segment at each vertex of `rapids`: `0` at its
   * start and its length at its end, so dashes restart on every segment (what
   * `LineDashedMaterial` reads as `lineDistance`).
   */
  rapidDistances: Float32Array;
  /**
   * A circle the size of the hole at the bottom of each drilled hole, which a
   * top view would otherwise show as nothing. Empty unless asked for.
   */
  holes: Float32Array;
  /**
   * An RGB multiplier of the line colour at each vertex of `feeds`, darker
   * the deeper it is: `1` at the stock top down to `DEEPEST_SHADE` at the
   * toolpath's deepest point (`vertexColors` in three.js). Empty unless
   * asked for.
   */
  feedColors: Float32Array;
};

export type ToolpathLinesOptions = {
  /**
   * Marks each straight plunge (a feed down with no XY movement) with a
   * circle of this radius, for drill operations. A plunge at the same XY as
   * the one before it, the next peck of the same hole, is merged into it, at
   * the deeper of the two.
   */
  holeRadius?: number | null;
  /** Shades `feeds` by depth into `feedColors`, for V-carving, whose depth varies along a pass. */
  shadeDepth?: boolean;
};

/** The colour multiplier at the deepest point of a depth-shaded toolpath. */
export const DEEPEST_SHADE = 0.35;

/** Sides of the circles that mark holes. */
const HOLE_SIDES = 24;

/** Builds the viewport lines of `toolpath`. */
export function toolpathLines(
  { moves }: Toolpath,
  { holeRadius = null, shadeDepth = false }: ToolpathLinesOptions = {},
): ToolpathLines {
  let feedCount = 0;
  for (let i = 1; i < moves.length; i++) if (moves[i]?.kind === "feed") feedCount++;
  const feeds = new Float32Array(feedCount * 6);
  const rapidCount = Math.max(moves.length - 1 - feedCount, 0);
  const rapids = new Float32Array(rapidCount * 6);
  const rapidDistances = new Float32Array(rapidCount * 2);
  const plunges: number[] = [];
  let f = 0;
  let r = 0;

  for (let i = 1; i < moves.length; i++) {
    const [ax, ay, az] = (moves[i - 1] as Toolpath["moves"][number]).to;
    const move = moves[i] as Toolpath["moves"][number];
    const [bx, by, bz] = move.to;
    const target = move.kind === "rapid" ? rapids : feeds;
    const at = move.kind === "rapid" ? r : f;
    target[at] = ax;
    target[at + 1] = ay;
    target[at + 2] = az;
    target[at + 3] = bx;
    target[at + 4] = by;
    target[at + 5] = bz;
    if (move.kind === "rapid") {
      rapidDistances[r / 3 + 1] = Math.hypot(bx - ax, by - ay, bz - az);
      r += 6;
      continue;
    }
    f += 6;
    if (holeRadius === null || bz >= az || Math.hypot(bx - ax, by - ay) >= GEOMETRY_TOLERANCE) {
      continue;
    }
    const last = plunges.length - 3;
    const samePlace =
      last >= 0 &&
      Math.hypot(bx - (plunges[last] as number), by - (plunges[last + 1] as number)) <
        GEOMETRY_TOLERANCE;
    if (!samePlace) plunges.push(bx, by, bz);
    else if (bz < (plunges[last + 2] as number)) plunges[last + 2] = bz;
  }

  const holes = holeRadius === null ? new Float32Array() : circles(plunges, holeRadius);
  const feedColors = shadeDepth ? depthShades(feeds) : new Float32Array();
  return { feeds, rapids, rapidDistances, holes, feedColors };
}

/** The `feedColors` of `feeds`: each vertex's depth below the stock top as a shade. */
function depthShades(feeds: Float32Array): Float32Array {
  let deepest = 0;
  for (let i = 2; i < feeds.length; i += 3) deepest = Math.min(deepest, feeds[i] as number);
  const colors = new Float32Array(feeds.length);
  for (let i = 0; i < feeds.length; i += 3) {
    const depth = deepest < 0 ? Math.min(1, Math.max(0, (feeds[i + 2] as number) / deepest)) : 0;
    colors.fill(1 - (1 - DEEPEST_SHADE) * depth, i, i + 3);
  }
  return colors;
}

/** A circle of `radius` around each `[x, y, z]` of `centers`, as `LineSegments` positions. */
function circles(centers: number[], radius: number): Float32Array {
  const positions = new Float32Array((centers.length / 3) * HOLE_SIDES * 6);
  let offset = 0;
  for (let i = 0; i < centers.length; i += 3) {
    const x = centers[i] as number;
    const y = centers[i + 1] as number;
    const z = centers[i + 2] as number;
    for (let j = 0; j < HOLE_SIDES; j++) {
      const a = (2 * Math.PI * j) / HOLE_SIDES;
      const b = (2 * Math.PI * (j + 1)) / HOLE_SIDES;
      positions[offset] = x + radius * Math.cos(a);
      positions[offset + 1] = y + radius * Math.sin(a);
      positions[offset + 2] = z;
      positions[offset + 3] = x + radius * Math.cos(b);
      positions[offset + 4] = y + radius * Math.sin(b);
      positions[offset + 5] = z;
      offset += 6;
    }
  }
  return positions;
}

/** The buffers of `lines`, to transfer them to another thread instead of copying. */
export function toolpathLinesBuffers(lines: ToolpathLines): ArrayBuffer[] {
  const { feeds, rapids, rapidDistances, holes, feedColors } = lines;
  return [
    feeds.buffer,
    rapids.buffer,
    rapidDistances.buffer,
    holes.buffer,
    feedColors.buffer,
  ] as ArrayBuffer[];
}
