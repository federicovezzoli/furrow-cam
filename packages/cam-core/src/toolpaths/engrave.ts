import type { EngraveOperation, EngraveParams, ProfileSide, Shape, Tool } from "@furrow/document";
import { cutterProfile } from "../simulation/simulation";
import { contourToolpath, type ProfileOptions } from "./profile";
import type { Toolpath } from "./toolpath";

export type EngraveOptions = ProfileOptions;

/**
 * The toolpath of an engrave operation (PRD-0001 R21), in stock coordinates:
 * the toolpath of a profile (R5) with no allowance, lead-in or tabs, in equal
 * passes no deeper than the tool's step-down, climb milling.
 *
 * - `on` follows every path as drawn, open paths first.
 * - `inside` and `outside` move the tool centre off the closed paths by half
 *   the `grooveWidth` at the depth, so one edge of the groove is on the line;
 *   nested paths toggle inside and outside (even-odd) as for profiles. Open
 *   paths are skipped with a warning.
 * - `chamfer` cuts the closed paths as `outside` does (see `engraveCut`).
 * - A V-bit cut deeper than its cone, or a chamfer wider than it, is warned
 *   about, since the cut can't get wider than the cone.
 */
export function engraveToolpath(
  operation: EngraveOperation,
  shapes: Shape[],
  options: EngraveOptions,
): Toolpath {
  const { tool, params } = operation;
  const cut = engraveCut(tool, params);
  const toolpath = contourToolpath(
    tool,
    shapes,
    {
      side: cut.side,
      direction: "climb",
      depth: cut.depth,
      ramp: params.ramp,
      startPoints: params.startPoints.map((start) => ({ start, plunge: null })),
      offset: cut.offset,
    },
    options,
  );
  if (cut.coneWide) {
    const code =
      params.side === "chamfer" ? "toolpath.chamferConeWide" : "toolpath.engraveConeWide";
    toolpath.warnings.push({ code });
  }
  return toolpath;
}

/** How an engraving cuts: the profile side, depth and tool centre's offset off the line. */
export type EngraveCut = { side: ProfileSide; depth: number; offset: number; coneWide: boolean };

/**
 * How the engraving `params` cut with `tool`. A chamfer (#554) runs the
 * V-bit's tip outside the line, its flat's inner edge on it, as deep as the
 * cone needs to reach `width` inside the line at the stock top; no deeper
 * than the cone, which a wider chamfer is warned about.
 */
export function engraveCut(tool: Tool, params: EngraveParams): EngraveCut {
  const { side, depth, width } = params;
  if (side !== "chamfer") {
    const offset = grooveWidth(tool, depth) / 2;
    return { side, depth, offset, coneWide: exceedsVBitCone(tool, depth) };
  }
  const tip = tool.tipDiameter ?? 0;
  const chamfer = vBitDepthForWidth(tool, 2 * (width ?? 0) + tip);
  const full = chamfer ?? vBitConeDepth(tool) ?? depth;
  return { side: "outside", depth: full, offset: tip / 2, coneWide: chamfer === null };
}

/**
 * The widest chamfer a V-bit cuts: its cone's width from the tip's edge out
 * to the diameter. `null` for other tools.
 */
export function maxChamferWidth(tool: Tool): number | null {
  if (tool.type !== "v_bit") return null;
  return (tool.diameter - (tool.tipDiameter ?? 0)) / 2;
}

/**
 * The width of the groove `tool` cuts at `depth`, at the stock top: a V-bit's
 * line width, the width of a ball or tapered end mill's profile at that depth
 * (the ball's chord, then the cone's, up to the diameter), the diameter of
 * any other tool.
 */
export function grooveWidth(tool: Tool, depth: number): number {
  const vBit = vBitLineWidth(tool, depth);
  if (vBit !== null) return vBit;
  return 2 * cutterProfile(tool).reach(depth);
}

/** Half the included angle of a V-bit, in radians. */
function halfAngle(tool: Tool): number {
  return (((tool.vAngle ?? 90) / 2) * Math.PI) / 180;
}

/**
 * How deep a V-bit's cone goes, from its tip to where it reaches the full
 * diameter, or `null` for other tools.
 */
export function vBitConeDepth(tool: Tool): number | null {
  if (tool.type !== "v_bit") return null;
  return (tool.diameter - (tool.tipDiameter ?? 0)) / 2 / Math.tan(halfAngle(tool));
}

/**
 * Whether a V-bit at `depth` goes deeper than its cone, so its line is as
 * wide as the bit. Rounding is ignored: a depth set from a line as wide as
 * the bit is the cone's own. `false` for other tools.
 */
export function exceedsVBitCone(tool: Tool, depth: number): boolean {
  const cone = vBitConeDepth(tool);
  return cone !== null && depth > cone + 1e-9;
}

/**
 * The width of the line a V-bit cuts at `depth`: its tip diameter, widening
 * with the cone, no wider than the bit. `null` for other tools.
 */
export function vBitLineWidth(tool: Tool, depth: number): number | null {
  if (tool.type !== "v_bit") return null;
  const width = (tool.tipDiameter ?? 0) + 2 * depth * Math.tan(halfAngle(tool));
  return Math.min(width, tool.diameter);
}

/**
 * The depth at which a V-bit cuts a line `width` wide: the inverse of
 * `vBitLineWidth` for widths wider than the tip and no wider than the bit.
 * `null` for other tools and for widths outside that range. Rounding is
 * ignored: a width summed up to the bit's own diameter is that diameter.
 */
export function vBitDepthForWidth(tool: Tool, width: number): number | null {
  if (tool.type !== "v_bit") return null;
  const tip = tool.tipDiameter ?? 0;
  if (width <= tip || width > tool.diameter + 1e-9) return null;
  return (width - tip) / 2 / Math.tan(halfAngle(tool));
}
