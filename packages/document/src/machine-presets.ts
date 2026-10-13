import type { Machine } from "./machine";

/**
 * The fields a preset can fill: facts about the machine. Name, safe Z, entry
 * clearance and post-processor come from `presetMachine` instead.
 */
export const PRESET_FIELDS = [
  "workAreaX",
  "workAreaY",
  "workAreaZ",
  "maxFeedXY",
  "maxFeedZ",
  "spindleRpmMin",
  "spindleRpmMax",
  "programStart",
  "programEnd",
  "operationStart",
  "toolChange",
] as const satisfies (keyof Machine)[];
export type PresetField = (typeof PRESET_FIELDS)[number];

/** Fields every preset either fills or asks the user for; the G-code blocks default to `null`. */
export const REQUIRED_PRESET_FIELDS = [
  "workAreaX",
  "workAreaY",
  "workAreaZ",
  "maxFeedXY",
  "maxFeedZ",
  "spindleRpmMin",
  "spindleRpmMax",
] as const satisfies PresetField[];
export type RequiredPresetField = (typeof REQUIRED_PRESET_FIELDS)[number];

/** Official documentation backing some of a preset's values (PRD-0004 M3). */
export type PresetSource = {
  title: string;
  url: string;
  /** The values this source states. */
  fields: PresetField[];
};

/** Values the user provides because no official source can (PRD-0004 M3, M4). */
export type PresetQuestion = {
  fields: RequiredPresetField[];
  /** What to enter and how to find it, e.g. how to measure a build's work area. */
  help: string;
};

/**
 * A machine in the preset catalog (PRD-0004 M1). Values come from official
 * documentation only, each listed in a source; what no source states is
 * asked of the user instead of guessed.
 */
export type MachinePreset = {
  /** Stable, URL-safe. */
  id: string;
  maker: string;
  model: string;
  /** E.g. a size or revision; `null` when the model has one. */
  variant: string | null;
  /** The controller firmware it needs, as shown in the picker (PRD-0004 M7). */
  firmware: string;
  values: Partial<Pick<Machine, PresetField>>;
  ask: PresetQuestion[];
  /** Shown when picking it (PRD-0004 M8). */
  notes: string[];
  sources: PresetSource[];
};

/** The default name of a machine created from `preset` (PRD-0004 M5). */
export function presetName(preset: MachinePreset): string {
  return preset.variant === null ? preset.model : `${preset.model} ${preset.variant}`;
}

/** The fields `preset` asks the user for. */
export function askedFields(preset: MachinePreset): RequiredPresetField[] {
  return preset.ask.flatMap((question) => question.fields);
}

/**
 * The values `preset` gives a new machine, on top of `NEW_MACHINE_DEFAULTS`.
 * The fields it asks for are left out, for the user to fill in.
 */
export function presetMachine(preset: MachinePreset): Partial<Machine> {
  return { name: presetName(preset), ...preset.values };
}

const V1E_MILLING_BASICS: PresetSource = {
  title: "V1 Engineering: Milling basics (GRBL/Jackpot G-code)",
  url: "https://docs.v1e.com/tools/milling-basics/",
  fields: ["programStart", "toolChange", "programEnd"],
};

/** V1 Engineering's start G-code for the Jackpot board, the same for the LowRider and the MPCNC. */
const V1E_PROGRAM_START = `G21
G90
G94
G10 L20 P0 X0 Y0 Z0 (set current location to zero, survives reboot)
G0 X10 Y10 F2000 (move to probing location)
M0 (MSG Attach probe)
G38.2 Z-110 F200 P0.5 (probe down set thickness )
G1 Z10 F900
M0 (MSG Remove probe)
M62 P1 (If used start spindle pin27 )`;

/** The Jackpot G-code uses FluidNC commands (`M62`/`M63`, `G38.2 … P`, `$HZ`) that GRBL rejects. */
const V1E_FIRMWARE =
  "Requires FluidNC on V1 Engineering's Jackpot board: the program start, tool change and end use FluidNC commands. GRBL, grblHAL and Marlin builds aren't supported yet.";

const V1E_NOTES = [
  "Manual router (e.g. a Makita RT0701C): set its speed on its dial; the G-code sets none.",
  "The program start, tool change and end are V1 Engineering's Jackpot G-code. The start zeroes X, Y and Z where the bit is and probes Z with a 0.5 mm touch plate, so jog to the project's zero point first and use the stock top as Z zero. M62 P1 and M63 P1 switch an optional router relay on pin 27.",
];

const LONGMILL_EEPROM: PresetSource = {
  title: "Sienci Labs: LongMill MK2 EEPROM settings",
  url: "https://resources.sienci.com/view/lmk2-eeprom-settings/",
  fields: ["workAreaX", "workAreaY", "workAreaZ", "maxFeedXY", "maxFeedZ"],
};

const LONGMILL_GSENDER: PresetSource = {
  title: "gSender: LongMill default settings (GRBL)",
  url: "https://github.com/Sienci-Labs/gsender/blob/7983320a4257069c50b64d11e2ed1e0341b9ffd6/src/app/src/features/Config/assets/MachineDefaults/grbl/longmill.js",
  fields: ["workAreaX", "workAreaY", "workAreaZ", "maxFeedXY", "maxFeedZ"],
};

const LONGMILL_SOURCES: PresetSource[] = [
  LONGMILL_EEPROM,
  LONGMILL_GSENDER,
  {
    title: "Sienci Labs: SuperLongBoard settings",
    url: "https://resources.sienci.com/view/slb-firmware-flashing/#settings-descriptions",
    fields: [],
  },
  {
    title: "Sienci Labs: LongMill MK2 routers and spindles",
    url: "https://resources.sienci.com/view/lmk2-routers-and-spindles/",
    fields: [],
  },
  {
    title: "Sienci Labs: All about the LongMill MK2",
    url: "https://sienci.com/2021/12/30/all-about-the-longmill-mk2/",
    fields: [],
  },
];

const LONGMILL_FIRMWARE =
  "Requires Sienci's LongBoard (GRBL 1.1h, LongMill MK2) or SuperLongBoard (grblHAL, LongMill MK2.5).";

const LONGMILL_SPINDLE: PresetQuestion = {
  fields: ["spindleRpmMin", "spindleRpmMax"],
  help: "Spindle: no router ships with the LongMill. Tick Manual spindle for a router set by its dial (e.g. a Makita RT0701), or enter the speed range of a controlled spindle, e.g. 7,500–24,000 RPM for Sienci's 1.5 kW spindle kit.",
};

/** One LongMill MK2 size; the rest is the same for all of them. */
function longMill(
  size: string,
  workArea: Pick<Machine, "workAreaX" | "workAreaY" | "workAreaZ">,
  advertised: string,
): MachinePreset {
  return {
    id: `sienci-longmill-mk2-${size}`,
    maker: "Sienci Labs",
    model: "LongMill MK2",
    variant: size,
    firmware: LONGMILL_FIRMWARE,
    values: { ...workArea, maxFeedXY: 4000, maxFeedZ: 3000 },
    ask: [LONGMILL_SPINDLE],
    notes: [
      `The work area is the smaller of the firmware's maximum travel ($130–$132) and Sienci's advertised area. ${advertised}`,
      "Max feed Z is the LongBoard's 3000 mm/min; the SuperLongBoard allows 4000 mm/min.",
      "Homing is off by default: zero X, Y and Z on the stock, e.g. with a touch plate.",
    ],
    sources: LONGMILL_SOURCES,
  };
}

const GENMITSU_FIRMWARE =
  "Runs GRBL 1.1h on its included controller, which ships configured for the machine.";

/** SainSmart publishes one "Max Speed" and only a maximum spindle speed. */
const GENMITSU_ASK: PresetQuestion[] = [
  {
    fields: ["maxFeedZ"],
    help: "Max feed Z: SainSmart gives one maximum speed, not one per axis. Send $$ in your G-code sender and enter $112, the Z axis maximum rate in mm/min.",
  },
  {
    fields: ["spindleRpmMin", "spindleRpmMax"],
    help: "Spindle: the stock 775 spindle is rated 9,000 RPM, and SainSmart publishes no minimum. Enter the slowest and fastest speeds you run it at, in RPM. The G-code's S words are in RPM, so GRBL's $30 (maximum spindle speed) should match the maximum.",
  },
];

/** The catalog, in the order shown within each maker. */
export const MACHINE_PRESETS: MachinePreset[] = [
  {
    id: "v1e-lowrider-v4",
    maker: "V1 Engineering",
    model: "LowRider v4",
    variant: null,
    firmware: V1E_FIRMWARE,
    values: {
      workAreaZ: 50,
      maxFeedXY: 9000,
      maxFeedZ: 900,
      spindleRpmMin: null,
      spindleRpmMax: null,
      programStart: V1E_PROGRAM_START,
      toolChange: `M63 P1 (turn off pin 27)
$HZ
G0 X10 Y10 F2000 (move to probing location, match first location)
M0 (MSG change tool, probe)
G38.2 Z-110 F200 P0.5 (Probe set thickness)
G00 Z10.0000 F500 (Clearance)
M0 (MSG remove probe)
M62 P1 (turn on pin27)`,
      programEnd: `M63 P1 (stop spindle pin27)
$HZ
M30`,
    },
    ask: [
      {
        fields: ["workAreaX", "workAreaY"],
        help: "Work area: the usable cutting area you built for, as entered in V1 Engineering's LowRider calculator (X is the beam, the shorter axis), e.g. 1220 × 2440 mm for a full sheet. To check a finished build, jog the bit between opposite corners of the area it can reach and note the distance on each axis.",
      },
    ],
    notes: [
      ...V1E_NOTES,
      "Z travel is the 50 mm cutting depth of a standard build; with a drop table you can use up to 100 mm.",
      "The endstops only act while homing and soft limits are off: keep the job inside your work area.",
    ],
    sources: [
      {
        title: "V1 Engineering: LowRider CNC",
        url: "https://docs.v1e.com/lowrider/",
        fields: ["workAreaZ", "spindleRpmMin", "spindleRpmMax"],
      },
      {
        title: "V1 Engineering: LowRider FluidNC config (Jackpot3)",
        url: "https://github.com/V1EngineeringInc/FluidNC_Configs/blob/fadbfe2/LowRider%20CNC/Jackpot3/JP3_LR/config.yaml",
        fields: ["maxFeedXY", "maxFeedZ", "spindleRpmMin", "spindleRpmMax"],
      },
      V1E_MILLING_BASICS,
      {
        title: "V1 Engineering: LowRider calculator",
        url: "https://docs.v1e.com/lowrider/calculator/",
        fields: [],
      },
    ],
  },
  {
    id: "v1e-mpcnc-primo",
    maker: "V1 Engineering",
    model: "MPCNC Primo",
    variant: null,
    firmware: V1E_FIRMWARE,
    values: {
      maxFeedXY: 9000,
      maxFeedZ: 900,
      spindleRpmMin: null,
      spindleRpmMax: null,
      programStart: V1E_PROGRAM_START,
      toolChange: `M63 P1 (turn off pin 27)
G91
G0 Z10
G90
G0 X10 Y10 F2000 (move to probing location, match first location)
M0 (MSG change tool, probe)
G38.2 Z-110 F200 P0.5 (Probe set thickness)
G00 Z10.0000 F500 (Clearance)
M0 (MSG remove probe)
M62 P1 (turn on pin27)`,
      programEnd: `M63 P1 (stop spindle pin27)
G91
G0 Z10
G90
M30`,
    },
    ask: [
      {
        fields: ["workAreaX", "workAreaY"],
        help: "Work area: the X and Y build area you chose in V1 Engineering's MPCNC calculator, the area the tool can reach (e.g. 450 × 330 mm with the kit's belt). Larger tools such as a DeWalt DW660 or a spindle reach less of it. To check a finished build, jog the bit between opposite corners of the area it can reach and note the distance on each axis.",
      },
      {
        fields: ["workAreaZ"],
        help: "Z travel: the Z build size from the calculator; 81 mm is the shortest, and the one V1 Engineering recommends.",
      },
    ],
    notes: [
      ...V1E_NOTES,
      "Z isn't homed, and soft limits are off: keep the job inside your work area.",
    ],
    sources: [
      {
        title: "V1 Engineering: MPCNC printed parts",
        url: "https://docs.v1e.com/mpcnc/PParts/",
        fields: ["spindleRpmMin", "spindleRpmMax"],
      },
      {
        title: "V1 Engineering: MPCNC FluidNC config (Jackpot3)",
        url: "https://github.com/V1EngineeringInc/FluidNC_Configs/blob/fadbfe2/MPCNC/Jackpot3/JP3_MPCNC/config.yaml",
        fields: ["maxFeedXY", "maxFeedZ", "spindleRpmMin", "spindleRpmMax"],
      },
      V1E_MILLING_BASICS,
      {
        title: "V1 Engineering: MPCNC calculator",
        url: "https://docs.v1e.com/mpcnc/calculator/",
        fields: [],
      },
    ],
  },
  {
    id: "maslow-4",
    maker: "Maslow CNC",
    model: "Maslow 4",
    variant: null,
    firmware: "Runs Maslow's own build of FluidNC, which comes on the Maslow 4 board.",
    values: {
      workAreaX: 2440,
      workAreaY: 1220,
      workAreaZ: 50,
      maxFeedXY: 2000,
      maxFeedZ: 300,
      spindleRpmMin: null,
      spindleRpmMax: null,
    },
    ask: [],
    notes: [
      "Keep the job inside the area you can cut. The firmware has no limit switches: it flattens moves outside its work area (2440 × 1220 mm by default, centred on the frame) onto its edge instead of stopping. Trace Boundary shows the outline before cutting.",
      "Switch the router (a DeWalt DWP611, or D26200 for 240 V) on and set its speed by hand; the G-code sets none.",
      "Max feeds are the lower official figures: the firmware's 2000 mm/min belt rate (the spec says 2500 mm/min X/Y) and the spec's 300 mm/min Z (the firmware allows 400).",
      "Z travel is the spec's 50 mm; the work area is listed as 65 mm deep.",
      "Set Z zero on the stock top with Define Z Home.",
    ],
    sources: [
      {
        title: "Maslow CNC: About Maslow 4",
        url: "https://www.maslowcnc.com/about-maslow4",
        fields: ["workAreaX", "workAreaY", "workAreaZ", "maxFeedZ"],
      },
      {
        title: "Maslow 4 firmware: default work area (Maslow.h)",
        url: "https://github.com/MaslowCNC/Maslow_4/blob/Maslow-Main/firmware/FluidNC/src/Maslow/Maslow.h",
        fields: ["workAreaX", "workAreaY"],
      },
      {
        title: "Maslow 4 firmware: maslow.yaml",
        url: "https://github.com/MaslowCNC/Maslow_4/blob/Maslow-Main/firmware/FluidNC/data/maslow.yaml",
        fields: ["maxFeedXY", "spindleRpmMin", "spindleRpmMax"],
      },
      {
        title: "Maslow 4: Quick start",
        url: "https://github.com/MaslowCNC/Maslow_4/blob/Maslow-Main/docs/QuickStart.md",
        fields: ["spindleRpmMin", "spindleRpmMax"],
      },
      {
        title: "Maslow 4 firmware: work area clamping (MaslowKinematics.cpp)",
        url: "https://github.com/MaslowCNC/Maslow_4/blob/Maslow-Main/firmware/FluidNC/src/Kinematics/MaslowKinematics.cpp",
        fields: [],
      },
    ],
  },
  longMill(
    "12x30",
    { workAreaX: 810, workAreaY: 355, workAreaZ: 120 },
    "Sienci advertises 820 × 368 mm, with about 125 mm of Z; the firmware's 810 × 355 × 120 mm is used.",
  ),
  longMill(
    "30x30",
    { workAreaX: 810, workAreaY: 855, workAreaZ: 120 },
    "Sienci advertises 820 × 868 mm, with about 125 mm of Z; the firmware's 810 × 855 × 120 mm is used.",
  ),
  // Sienci states a 48 × 30 in working area, smaller than the firmware's 1270 × 855 mm travel.
  longMill(
    "48x30",
    { workAreaX: 1219.2, workAreaY: 762, workAreaZ: 120 },
    "Sienci advertises 48 × 30 in (1219.2 × 762 mm), which this preset uses for X and Y; the firmware allows 1270 × 855 mm.",
  ),
  {
    id: "sainsmart-genmitsu-3018-rex",
    maker: "SainSmart",
    model: "Genmitsu 3018",
    variant: "REX",
    firmware: GENMITSU_FIRMWARE,
    values: { workAreaX: 300, workAreaY: 180, workAreaZ: 60, maxFeedXY: 3000 },
    ask: GENMITSU_ASK,
    notes: ["Has X, Y and Z limit switches for homing, and a Z probe for setting Z zero."],
    sources: [
      {
        title: "SainSmart: Genmitsu 3018 REX user guide",
        url: "https://genmitsu.s3.dualstack.us-east-1.amazonaws.com/GM-3018REX/Genmitsu_3018_REX_CNC_Router_Kit_User_Guide_260811.pdf",
        fields: ["workAreaX", "workAreaY", "workAreaZ", "maxFeedXY"],
      },
      {
        title: "SainSmart: Genmitsu 3018 REX",
        url: "https://www.sainsmart.com/products/3018-rex",
        fields: ["workAreaX", "workAreaY", "workAreaZ", "maxFeedXY"],
      },
    ],
  },
  {
    id: "sainsmart-genmitsu-3018-prover-v2",
    maker: "SainSmart",
    model: "Genmitsu 3018",
    variant: "PROVer V2",
    firmware: GENMITSU_FIRMWARE,
    values: { workAreaX: 284, workAreaY: 180, workAreaZ: 40, maxFeedXY: 2000 },
    ask: GENMITSU_ASK,
    notes: [
      "The work area is the user manual's; the product page lists 290 mm of X.",
      "Has home and limit switches, and a Z probe for setting Z zero.",
    ],
    sources: [
      {
        title: "SainSmart: Genmitsu 3018-PROVer V2 user manual",
        url: "https://genmitsu.s3.us-east-1.amazonaws.com/101-60-3018PV2/3018-PROVer_V2_User_Manual_%E3%80%90EN%2BDE%2BJP_V1.0_20220906_1.pdf",
        fields: ["workAreaX", "workAreaY", "workAreaZ", "maxFeedXY"],
      },
      {
        title: "SainSmart: Genmitsu 3018-PROVer V2",
        url: "https://www.sainsmart.com/products/genmitsu-3018-prover-v2-upgraded-semi-assembled-cnc-router-kit",
        fields: ["workAreaY", "workAreaZ"],
      },
    ],
  },
];
