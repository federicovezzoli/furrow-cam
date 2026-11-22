import { formatNumber } from "../format";
import type { Dialect, PostProcessor } from "../post";
import { comment } from "../program/gcode-writer";
import { postProgram } from "../program/program";

/**
 * GRBL 1.1 (PRD-0001 R11), and grblHAL and FluidNC, which read it: the modes
 * on one line, comments in parentheses, `G4 P` in seconds, `M0` pauses and
 * `M30` ending the program.
 */
export const GRBL: Dialect = {
  comment,
  modes: ["G21 G90 G94 G17"],
  dwell: (seconds) => `G4 P${formatNumber(seconds)}`,
  pause: (message) => `M0 ${comment(message)}`,
  end: ["M30"],
  rapidFeed: false,
};

export const grbl: PostProcessor = {
  id: "grbl",
  extension: ".gcode",
  dialect: GRBL,
  post: (input) => postProgram(input, GRBL),
};
