import { describe, expect, it } from "vitest";
import { Machine } from "./machine";
import {
  askedFields,
  MACHINE_PRESETS,
  presetMachine,
  presetName,
  REQUIRED_PRESET_FIELDS,
  type RequiredPresetField,
} from "./machine-presets";

/** What a user might enter for each asked field. */
const SAMPLE_ANSWERS: Pick<Machine, RequiredPresetField> = {
  workAreaX: 600,
  workAreaY: 900,
  workAreaZ: 80,
  maxFeedXY: 3000,
  maxFeedZ: 600,
  spindleRpmMin: 10000,
  spindleRpmMax: 30000,
};

describe("MACHINE_PRESETS", () => {
  it("has the first-round machines (PRD-0004 M2)", () => {
    const models = new Set(MACHINE_PRESETS.map((preset) => `${preset.maker} ${preset.model}`));
    expect(models).toEqual(
      new Set([
        "V1 Engineering LowRider v4",
        "V1 Engineering MPCNC Primo",
        "Maslow CNC Maslow 4",
        "Sienci Labs LongMill MK2",
        "SainSmart Genmitsu 3018",
      ]),
    );
  });

  it("has unique, URL-safe ids and unique names", () => {
    const ids = MACHINE_PRESETS.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    const names = MACHINE_PRESETS.map(presetName);
    expect(new Set(names).size).toBe(names.length);
  });

  describe.each(MACHINE_PRESETS.map((preset) => [preset.id, preset] as const))(
    "%s",
    (_, preset) => {
      const asked = askedFields(preset);

      it("fills or asks for every required field, never both", () => {
        for (const field of REQUIRED_PRESET_FIELDS) {
          expect(field in preset.values !== asked.includes(field), field).toBe(true);
        }
        expect(new Set(asked).size).toBe(asked.length);
      });

      it("asks for both spindle speeds together", () => {
        expect(asked.includes("spindleRpmMin")).toBe(asked.includes("spindleRpmMax"));
      });

      it("lists a source for every value (PRD-0004 M3, M11)", () => {
        expect(preset.sources.length).toBeGreaterThan(0);
        for (const source of preset.sources) {
          expect(source.url).toMatch(/^https:\/\//);
          expect(source.title.trim()).not.toBe("");
        }
        const sourced = new Set(preset.sources.flatMap((source) => source.fields));
        for (const field of Object.keys(preset.values)) expect(sourced, field).toContain(field);
      });

      it("states its firmware", () => {
        expect(preset.firmware.trim()).not.toBe("");
      });

      it("makes a valid machine with sample answers (PRD-0004 M11)", () => {
        const answers = Object.fromEntries(asked.map((field) => [field, SAMPLE_ANSWERS[field]]));
        const machine = {
          programStart: null,
          programEnd: null,
          operationStart: null,
          toolChange: null,
          ...presetMachine(preset),
          ...answers,
        };
        expect(Machine.safeParse(machine).error).toBeUndefined();
        expect(machine.name).toBe(presetName(preset));
      });
    },
  );
});
