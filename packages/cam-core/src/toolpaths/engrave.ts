import type { EngraveOperation, Shape, Tool } from "@furrow/document";
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
 * - A V-bit cut deeper than its cone is warned about, since the line can't
 *   get wider than the bit.
 */
export function engraveToolpath(
  operation: EngraveOperation,
  shapes: Shape[],
  options: EngraveOptions,
): Toolpath {
  const { tool, params } = operation;
  const toolpath = contourToolpath(
    tool,
    shapes,
    {
      side: params.side,
      direction: "climb",
      depth: params.depth,
      ramp: params.ramp,
      offset: grooveWidth(tool, params.depth) / 2,
    },
    options,
  );
  if (exceedsVBitCone(tool, params.depth)) {
    toolpath.warnings.push(
      "The depth exceeds the V-bit's cone, so the line is as wide as the bit.",
    );
  }
  return toolpath;
}

/**
 * The width of the groove `tool` cuts at `depth`, at the stock top: a V-bit's
 * line width, a ball end mill's chord at that depth (its diameter once past
 * its radius), the diameter of any other tool.
 */
export function grooveWidth(tool: Tool, depth: number): number {
  const vBit = vBitLineWidth(tool, depth);
  if (vBit !== null) return vBit;
  const radius = tool.diameter / 2;
  if (tool.type === "ball_end_mill" && depth < radius) {
    return 2 * Math.sqrt(radius * radius - (radius - depth) ** 2);
  }
  return tool.diameter;
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
 * `null` for other tools and for widths outside that range.
 */
export function vBitDepthForWidth(tool: Tool, width: number): number | null {
  if (tool.type !== "v_bit") return null;
  const tip = tool.tipDiameter ?? 0;
  if (width <= tip || width > tool.diameter) return null;
  return (width - tip) / 2 / Math.tan(halfAngle(tool));
}
