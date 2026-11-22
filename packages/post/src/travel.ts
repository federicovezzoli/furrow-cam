import type { Machine } from "@furrow/document";
import type { PostWarning } from "./post";
import { EPSILON, gcodeMoves, parseGcode, round } from "./read-back";

/**
 * A warning for each axis `gcode` spans more of than the machine travels
 * (`workAreaX/Y/Z`), none without a machine. Read back from the program, so it
 * covers retracts, tool changes and custom blocks as the machine will run them.
 */
export function travelWarnings(gcode: string, machine: Machine | null): PostWarning[] {
  if (machine === null) return [];
  const low = [Infinity, Infinity, Infinity];
  const high = [-Infinity, -Infinity, -Infinity];
  for (const { to } of gcodeMoves(parseGcode(gcode))) {
    to.forEach((value, axis) => {
      if (!Number.isFinite(value)) return;
      low[axis] = Math.min(low[axis] as number, value);
      high[axis] = Math.max(high[axis] as number, value);
    });
  }
  const travel = [machine.workAreaX, machine.workAreaY, machine.workAreaZ];
  return (["X", "Y", "Z"] as const).flatMap((axis, index) => {
    // An axis the program never sets spans -Infinity, never over travel.
    const span = (high[index] as number) - (low[index] as number);
    const limit = travel[index] as number;
    if (!(span > limit + EPSILON)) return [];
    return [
      {
        message: {
          code: "export.exceedsTravel" as const,
          values: { axis, span: round(span), travel: limit },
        },
      },
    ];
  });
}
