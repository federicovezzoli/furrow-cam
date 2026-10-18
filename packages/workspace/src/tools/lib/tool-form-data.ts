import { Tool } from "@furrow/document";
import { issuesToFormErrors, numberField } from "../../lib/form-data";
import { TOOL_COLORS } from "./colors";

/** Seeded into every new account, so a first project can be cut without setting up a library. */
export const DEFAULT_TOOL: Tool = Tool.parse({
  name: "6 mm 2-flute upcut",
  type: "flat_end_mill",
  diameter: 6,
  fluteCount: 2,
  fluteLength: 22,
  cutDirection: "upcut",
  vAngle: null,
  tipDiameter: null,
  spindleRpm: 24000,
  feedRate: 600,
  plungeRate: 300,
  plungeAngle: 3,
  stepDown: 1,
  stepOver: 40,
  notes: null,
  color: TOOL_COLORS[0],
});

/**
 * Reads the tool form. Fields that don't apply to the chosen type are ignored,
 * so switching type in the form never leaves stale values behind.
 */
export function parseToolForm(form: FormData) {
  const type = form.get("type");
  const isEndMill = type === "flat_end_mill" || type === "ball_end_mill";
  const isVBit = type === "v_bit";
  const notes = String(form.get("notes") ?? "").trim();
  const input = {
    name: String(form.get("name") ?? ""),
    type,
    diameter: numberField(form, "diameter"),
    fluteCount: numberField(form, "fluteCount"),
    fluteLength: numberField(form, "fluteLength"),
    cutDirection: isEndMill ? (form.get("cutDirection") ?? null) : null,
    vAngle: isVBit ? numberField(form, "vAngle") : null,
    tipDiameter: isVBit ? numberField(form, "tipDiameter") : null,
    spindleRpm: numberField(form, "spindleRpm"),
    feedRate: numberField(form, "feedRate"),
    plungeRate: numberField(form, "plungeRate"),
    plungeAngle: type === "drill" ? 90 : numberField(form, "plungeAngle"),
    stepDown: numberField(form, "stepDown"),
    stepOver: numberField(form, "stepOver"),
    notes: notes === "" ? null : notes,
    color: String(form.get("color") ?? "").toLowerCase(),
  };
  const result = Tool.safeParse(input);
  if (result.success) return { tool: result.data };

  return { errors: issuesToFormErrors<keyof Tool>(result.error.issues, input) };
}
