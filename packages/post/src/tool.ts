import type { Tool } from "@furrow/document";
import { formatNumber } from "./format";
import { comment } from "./gcode-writer";

/** Whether two tool snapshots are the same bit, so no tool change is needed. */
export function sameBit(a: Tool, b: Tool): boolean {
  return (
    a.name === b.name &&
    a.type === b.type &&
    a.diameter === b.diameter &&
    a.fluteCount === b.fluteCount &&
    a.fluteLength === b.fluteLength &&
    a.cutDirection === b.cutDirection &&
    a.vAngle === b.vAngle &&
    a.tipDiameter === b.tipDiameter
  );
}

/**
 * The cutter shape the G-code simulation sweeps with (ADR-0042), in
 * millimetres and degrees, leaving out the fields that don't apply:
 * `(Furrow tool: type=v_bit diameter=12 vAngle=60 tipDiameter=0.2)`.
 */
export function toolShapeComment({ type, diameter, vAngle, tipDiameter }: Tool): string {
  const fields = [`type=${type}`, `diameter=${formatNumber(diameter)}`];
  if (vAngle !== null) fields.push(`vAngle=${formatNumber(vAngle)}`);
  if (tipDiameter !== null) fields.push(`tipDiameter=${formatNumber(tipDiameter)}`);
  return comment(`Furrow tool: ${fields.join(" ")}`);
}

export function toolLabel(tool: Tool): string {
  return `${tool.name}, ${formatNumber(tool.diameter)} mm`;
}
