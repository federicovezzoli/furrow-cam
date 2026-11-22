import { formatNumber } from "../format";
import type { Dialect, PostProcessor } from "../post";
import { lineComment, oneLine } from "../program/gcode-writer";
import { postProgram } from "../program/program";

/**
 * Marlin 2.1 (#578, ADR-0091), as its documentation describes it; not yet
 * checked on a machine.
 *
 * - One G-code per line: Marlin runs only a line's first. `G21` and `G90`,
 *   without `G94` (feed is always per minute) or `G17` (no arcs are written).
 * - `;` comments: parentheses need `PAREN_COMMENTS`.
 * - `G4 S` in seconds: `P` is milliseconds.
 * - `M0` shows the rest of its line on the LCD, so its message isn't a comment.
 * - No `M30`, which deletes a file on the SD card, and no `M84`, which would
 *   let the steppers lose their position.
 * - `M3 S` is in RPM only with `CUTTER_POWER_UNIT RPM`: Marlin's default,
 *   `PWM255`, clamps it to full power. A manual spindle writes no `S`.
 * - Without `G0_FEEDRATE`, `G0` runs at the last `F`, so each rapid carries
 *   the machine's maximum XY feed (Marlin keeps each axis to its own) and the
 *   next cut writes its feed again.
 */
export const MARLIN: Dialect = {
  comment: lineComment,
  modes: ["G21", "G90"],
  dwell: (seconds) => `G4 S${formatNumber(seconds)}`,
  // A `;` would end the message early.
  pause: (message) => `M0 ${oneLine(message).replace(/;/g, ",")}`,
  end: [],
  rapidFeed: true,
};

export const marlin: PostProcessor = {
  id: "marlin",
  extension: ".gcode",
  dialect: MARLIN,
  post: (input) => postProgram(input, MARLIN),
};
