import { GEOMETRY_TOLERANCE } from "@furrow/document";
import type { Toolpath } from "./toolpath";

/**
 * A toolpath as typed arrays for the viewport (ADR-0008), built in the worker
 * that computes it and transferred without copying. `feeds` and `rapids` are
 * `LineSegments` positions in stock coordinates: `[x, y, z]` per vertex, two
 * vertices per move. The first move has no start, so it has no segment.
 */
export type ToolpathLines = {
  feeds: Float32Array;
  rapids: Float32Array;
  /**
   * `[x, y, z]` of each straight plunge: feeds down with no XY movement (a
   * drilled hole), which a top view would show as nothing. A plunge at the
   * same XY as the one before it (the next peck or pass) is merged into it,
   * at the deeper of the two.
   */
  plunges: Float32Array;
};

/** Builds the viewport lines of `toolpath`. */
export function toolpathLines({ moves }: Toolpath): ToolpathLines {
  let feedCount = 0;
  for (let i = 1; i < moves.length; i++) if (moves[i]?.kind === "feed") feedCount++;
  const feeds = new Float32Array(feedCount * 6);
  const rapids = new Float32Array(Math.max(moves.length - 1 - feedCount, 0) * 6);
  const plunges: number[] = [];
  let f = 0;
  let r = 0;

  for (let i = 1; i < moves.length; i++) {
    const [ax, ay, az] = (moves[i - 1] as Toolpath["moves"][number]).to;
    const move = moves[i] as Toolpath["moves"][number];
    const [bx, by, bz] = move.to;
    if (move.kind === "rapid") {
      rapids.set([ax, ay, az, bx, by, bz], r);
      r += 6;
      continue;
    }
    feeds.set([ax, ay, az, bx, by, bz], f);
    f += 6;
    if (bz >= az || Math.hypot(bx - ax, by - ay) >= GEOMETRY_TOLERANCE) continue;
    const last = plunges.length - 3;
    const sameHole =
      last >= 0 &&
      Math.hypot(bx - (plunges[last] as number), by - (plunges[last + 1] as number)) <
        GEOMETRY_TOLERANCE;
    if (!sameHole) plunges.push(bx, by, bz);
    else if (bz < (plunges[last + 2] as number)) plunges[last + 2] = bz;
  }

  return { feeds, rapids, plunges: new Float32Array(plunges) };
}

/** The buffers of `lines`, to transfer them to another thread instead of copying. */
export function toolpathLinesBuffers({ feeds, rapids, plunges }: ToolpathLines): ArrayBuffer[] {
  return [feeds.buffer, rapids.buffer, plunges.buffer] as ArrayBuffer[];
}
