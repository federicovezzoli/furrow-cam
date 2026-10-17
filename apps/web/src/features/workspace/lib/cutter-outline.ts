import { type CutterShape, cutterProfile } from "@furrow/cam-core";

/** Points along a ball end mill's or a V-bit's edge, from its axis out. */
const EDGE_STEPS = 16;

/**
 * The outline of a cutter to draw it turning (`LatheGeometry`), as `[r, z]`
 * points from its tip up, in millimetres: its cutting edge as the simulation
 * sees it (`cutterProfile`), then straight up, two diameters above where the
 * edge reaches its full width, and back in to its axis, so the top is closed.
 */
export function cutterOutline(tool: CutterShape): [number, number][] {
  const { radius, flat, height } = cutterProfile(tool);
  const points: [number, number][] = [];
  const steps = flat ? 1 : EDGE_STEPS;
  for (let i = 0; i <= steps; i++) {
    const r = (radius * i) / steps;
    points.push([r, height(r)]);
  }
  const top = height(radius) + 2 * tool.diameter;
  points.push([radius, top], [0, top]);
  return points;
}
