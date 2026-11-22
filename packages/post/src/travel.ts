import type { Machine } from "@furrow/document";
import type { PostWarning } from "./post";
import { type CustomBlock, EPSILON, gcodeMoves, parseGcode, round } from "./read-back";

/**
 * A warning for each axis `gcode` spans more of than the machine travels
 * (`workAreaX/Y/Z`), none without a machine. Read back from the program's own
 * moves: the custom `blocks` are left out, since they are written by hand and
 * may move in machine coordinates (`G53`), probe or park where work
 * coordinates can't follow.
 */
export function travelWarnings(
  gcode: string,
  machine: Machine | null,
  blocks: readonly CustomBlock[],
): PostWarning[] {
  if (machine === null) return [];
  const own = gcode
    .split("\n")
    .map((line, i) =>
      blocks.some(({ first, last }) => first <= i + 1 && i + 1 <= last) ? "" : line,
    )
    .join("\n");
  const low = [Infinity, Infinity, Infinity];
  const high = [-Infinity, -Infinity, -Infinity];
  for (const { to } of gcodeMoves(parseGcode(own))) {
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
