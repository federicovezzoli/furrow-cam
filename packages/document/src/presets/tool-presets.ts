import { Tool } from "../schema/tool";

/**
 * A bit from the built-in catalog (PRD-0008 G4), offered next to the user's
 * library in every app. `id` is stable across releases: it tells catalog bits
 * apart from library ones and never collides with a library id.
 */
export type ToolPreset = { id: string; tool: Tool };

/** The catalog's ids all start with this, unlike the library's UUIDs. */
export const TOOL_PRESET_ID_PREFIX = "catalog:";

/** One inch, in millimetres. */
const INCH = 25.4;

/** The palette new library tools take their colours from, so catalog bits look the same. */
const COLORS = {
  blue: "#2563eb",
  red: "#dc2626",
  green: "#16a34a",
  amber: "#d97706",
  purple: "#9333ea",
  cyan: "#0891b2",
  pink: "#db2777",
  lime: "#65a30d",
} as const;

const END_MILL = {
  type: "flat_end_mill",
  fluteCount: 2,
  vAngle: null,
  tipDiameter: null,
  taperAngle: null,
  plungeAngle: 3,
  notes: null,
} as const;

/** Cautious figures for a 3 mm or 1/8" bit in softwood and plywood on a hobby router. */
const SMALL = { spindleRpm: 18000, feedRate: 500, plungeRate: 200, stepDown: 0.75 } as const;

/** Cautious figures for a 6 mm or 1/4" bit in softwood and plywood on a hobby router. */
const LARGE = { spindleRpm: 24000, feedRate: 600, plungeRate: 300, stepDown: 1 } as const;

/** The cutting length of a V-bit of `angle` degrees from its `diameter` down to its `tip`. */
function vBitLength(diameter: number, angle: number, tip: number): number {
  return Math.round(((diameter - tip) / 2 / Math.tan((angle * Math.PI) / 360)) * 100) / 100;
}

function vBit(name: string, diameter: number, angle: number, tip: number, color: string): Tool {
  return {
    name,
    type: "v_bit",
    diameter,
    fluteCount: 2,
    fluteLength: vBitLength(diameter, angle, tip),
    cutDirection: null,
    vAngle: angle,
    tipDiameter: tip,
    taperAngle: null,
    spindleRpm: 18000,
    feedRate: angle < 60 ? 400 : 800,
    plungeRate: angle < 60 ? 150 : 300,
    plungeAngle: 90,
    stepDown: angle < 60 ? 0.5 : 1.5,
    notes: null,
    color,
  };
}

/**
 * A 1/8" shank tapered ball nose with a `tip`-diameter ball and `angle`
 * degrees per side, cutting `length` up the cone: its diameter is the
 * cone's at the top of the cut.
 */
function taperedBit(tip: number, angle: number, length: number, color: string): Tool {
  const radians = (angle * Math.PI) / 180;
  const r = tip / 2;
  const top = r * Math.cos(radians) + (length - r * (1 - Math.sin(radians))) * Math.tan(radians);
  return {
    ...END_MILL,
    name: `${tip} mm tip ${angle}° tapered ball nose`,
    type: "tapered_ball_end_mill",
    diameter: Math.round(2 * top * 100) / 100,
    fluteLength: length,
    cutDirection: "upcut",
    tipDiameter: tip,
    taperAngle: angle,
    spindleRpm: 18000,
    feedRate: 400,
    plungeRate: 150,
    stepDown: 0.5,
    color,
  };
}

const PRESETS: Record<string, Tool> = {
  "6mm-upcut": {
    ...END_MILL,
    ...LARGE,
    name: "6 mm 2-flute upcut",
    diameter: 6,
    fluteLength: 22,
    cutDirection: "upcut",
    color: COLORS.blue,
  },
  "6mm-downcut": {
    ...END_MILL,
    ...LARGE,
    name: "6 mm 2-flute downcut",
    diameter: 6,
    fluteLength: 22,
    cutDirection: "downcut",
    color: COLORS.red,
  },
  "6mm-compression": {
    ...END_MILL,
    ...LARGE,
    name: "6 mm 2-flute compression",
    diameter: 6,
    fluteLength: 22,
    cutDirection: "compression",
    color: COLORS.green,
  },
  "3mm-upcut": {
    ...END_MILL,
    ...SMALL,
    name: "3 mm 2-flute upcut",
    diameter: 3,
    fluteLength: 12,
    cutDirection: "upcut",
    color: COLORS.amber,
  },
  "quarter-inch-upcut": {
    ...END_MILL,
    ...LARGE,
    name: '1/4" 2-flute upcut',
    diameter: INCH / 4,
    fluteLength: INCH,
    cutDirection: "upcut",
    color: COLORS.purple,
  },
  "quarter-inch-downcut": {
    ...END_MILL,
    ...LARGE,
    name: '1/4" 2-flute downcut',
    diameter: INCH / 4,
    fluteLength: INCH,
    cutDirection: "downcut",
    color: COLORS.cyan,
  },
  "eighth-inch-upcut": {
    ...END_MILL,
    ...SMALL,
    name: '1/8" 2-flute upcut',
    diameter: INCH / 8,
    fluteLength: INCH / 2,
    cutDirection: "upcut",
    color: COLORS.pink,
  },
  "eighth-inch-downcut": {
    ...END_MILL,
    ...SMALL,
    name: '1/8" 2-flute downcut',
    diameter: INCH / 8,
    fluteLength: INCH / 2,
    cutDirection: "downcut",
    color: COLORS.lime,
  },
  "6mm-ball": {
    ...END_MILL,
    ...LARGE,
    name: "6 mm ball nose",
    type: "ball_end_mill",
    diameter: 6,
    fluteLength: 22,
    cutDirection: "upcut",
    color: COLORS.blue,
  },
  "3mm-ball": {
    ...END_MILL,
    ...SMALL,
    name: "3 mm ball nose",
    type: "ball_end_mill",
    diameter: 3,
    fluteLength: 12,
    cutDirection: "upcut",
    color: COLORS.red,
  },
  "eighth-inch-ball": {
    ...END_MILL,
    ...SMALL,
    name: '1/8" ball nose',
    type: "ball_end_mill",
    diameter: INCH / 8,
    fluteLength: INCH / 2,
    cutDirection: "upcut",
    color: COLORS.green,
  },
  "half-mm-tapered": taperedBit(0.5, 1.5, 20, COLORS.pink),
  "1mm-tapered": taperedBit(1, 3.5, 15, COLORS.lime),
  v90: vBit("90° V-bit", INCH / 2, 90, 0, COLORS.amber),
  v60: vBit("60° V-bit", INCH / 2, 60, 0, COLORS.purple),
  v30: vBit("30° engraving V-bit", INCH / 8, 30, 0.2, COLORS.cyan),
};

/**
 * Common bits with conservative feeds and speeds for softwood and plywood on
 * a hobby router (PRD-0008 G5): starting points, not figures for every
 * machine or material. Grouped by type, then by size.
 */
export const TOOL_PRESETS: readonly ToolPreset[] = Object.entries(PRESETS).map(([id, tool]) => ({
  id: `${TOOL_PRESET_ID_PREFIX}${id}`,
  tool: Tool.parse(tool),
}));

/** The catalog bit new operations start with when the user's library has no default. */
export const DEFAULT_TOOL_PRESET = TOOL_PRESETS[0] as ToolPreset;
