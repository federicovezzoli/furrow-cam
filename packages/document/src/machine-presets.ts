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

/**
 * The presets' texts as codes (ADR-0054): firmware, notes and questions are
 * translated in the UI, under `Core.preset`.
 */
export const PRESET_MESSAGES = [
  "preset.v1e.firmware",
  "preset.v1e.manualRouter",
  "preset.v1e.jackpotGcode",
  "preset.longmill.firmware",
  "preset.longmill.spindle",
  "preset.longmill.workArea",
  "preset.longmill.maxFeedZ",
  "preset.longmill.homing",
  "preset.genmitsu.firmware",
  "preset.genmitsu.maxFeedZ",
  "preset.genmitsu.spindle",
  "preset.lowrider.workArea",
  "preset.lowrider.zTravel",
  "preset.lowrider.endstops",
  "preset.mpcnc.workArea",
  "preset.mpcnc.zTravel",
  "preset.mpcnc.limits",
  "preset.maslow.firmware",
  "preset.maslow.area",
  "preset.maslow.router",
  "preset.maslow.maxFeeds",
  "preset.maslow.zTravel",
  "preset.maslow.zZero",
  "preset.longmill.advertised12x30",
  "preset.longmill.advertised30x30",
  "preset.longmill.advertised48x30",
  "preset.genmitsu.rexSwitches",
  "preset.genmitsu.proverWorkArea",
  "preset.genmitsu.proverSwitches",
] as const;
export type PresetMessageCode = (typeof PRESET_MESSAGES)[number];

/** Values the user provides because no official source can (PRD-0004 M3, M4). */
export type PresetQuestion = {
  fields: RequiredPresetField[];
  /** What to enter and how to find it, e.g. how to measure a build's work area. */
  help: PresetMessageCode;
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
  firmware: PresetMessageCode;
  values: Partial<Pick<Machine, PresetField>>;
  ask: PresetQuestion[];
  /** Shown when picking it (PRD-0004 M8). */
  notes: PresetMessageCode[];
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
const V1E_FIRMWARE = "preset.v1e.firmware";

const V1E_NOTES: PresetMessageCode[] = ["preset.v1e.manualRouter", "preset.v1e.jackpotGcode"];

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

const LONGMILL_FIRMWARE = "preset.longmill.firmware";

const LONGMILL_SPINDLE: PresetQuestion = {
  fields: ["spindleRpmMin", "spindleRpmMax"],
  help: "preset.longmill.spindle",
};

/** One LongMill MK2 size; the rest is the same for all of them. */
function longMill(
  size: string,
  workArea: Pick<Machine, "workAreaX" | "workAreaY" | "workAreaZ">,
  advertised: PresetMessageCode,
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
      "preset.longmill.workArea",
      advertised,
      "preset.longmill.maxFeedZ",
      "preset.longmill.homing",
    ],
    sources: LONGMILL_SOURCES,
  };
}

const GENMITSU_FIRMWARE = "preset.genmitsu.firmware";

/** SainSmart publishes one "Max Speed" and only a maximum spindle speed. */
const GENMITSU_ASK: PresetQuestion[] = [
  {
    fields: ["maxFeedZ"],
    help: "preset.genmitsu.maxFeedZ",
  },
  {
    fields: ["spindleRpmMin", "spindleRpmMax"],
    help: "preset.genmitsu.spindle",
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
        help: "preset.lowrider.workArea",
      },
    ],
    notes: [...V1E_NOTES, "preset.lowrider.zTravel", "preset.lowrider.endstops"],
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
        help: "preset.mpcnc.workArea",
      },
      {
        fields: ["workAreaZ"],
        help: "preset.mpcnc.zTravel",
      },
    ],
    notes: [...V1E_NOTES, "preset.mpcnc.limits"],
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
    firmware: "preset.maslow.firmware",
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
      "preset.maslow.area",
      "preset.maslow.router",
      "preset.maslow.maxFeeds",
      "preset.maslow.zTravel",
      "preset.maslow.zZero",
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
    "preset.longmill.advertised12x30",
  ),
  longMill(
    "30x30",
    { workAreaX: 810, workAreaY: 855, workAreaZ: 120 },
    "preset.longmill.advertised30x30",
  ),
  // Sienci states a 48 × 30 in working area, smaller than the firmware's 1270 × 855 mm travel.
  longMill(
    "48x30",
    { workAreaX: 1219.2, workAreaY: 762, workAreaZ: 120 },
    "preset.longmill.advertised48x30",
  ),
  {
    id: "sainsmart-genmitsu-3018-rex",
    maker: "SainSmart",
    model: "Genmitsu 3018",
    variant: "REX",
    firmware: GENMITSU_FIRMWARE,
    values: { workAreaX: 300, workAreaY: 180, workAreaZ: 60, maxFeedXY: 3000 },
    ask: GENMITSU_ASK,
    notes: ["preset.genmitsu.rexSwitches"],
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
    notes: ["preset.genmitsu.proverWorkArea", "preset.genmitsu.proverSwitches"],
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
