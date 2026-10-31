import { DEFAULT_TOOL_PRESET, isEndMill, Tool, taperedDiameter } from "@furrow/document";
import { issuesToFormErrors, numberField } from "../../lib/form-data";

/**
 * Seeded into every new library, so a first project can be cut without
 * setting up a library: the catalog's default bit (PRD-0008 G4).
 */
export const DEFAULT_TOOL: Tool = DEFAULT_TOOL_PRESET.tool;

/**
 * Reads the tool form. Fields that don't apply to the chosen type are ignored,
 * so switching type in the form never leaves stale values behind.
 */
export function parseToolForm(form: FormData) {
  const type = form.get("type");
  const isTapered = type === "tapered_ball_end_mill";
  const isVBit = type === "v_bit";
  const tipDiameter = isVBit || isTapered ? numberField(form, "tipDiameter") : null;
  const taperAngle = isTapered ? numberField(form, "taperAngle") : null;
  const fluteLength = numberField(form, "fluteLength");
  const notes = String(form.get("notes") ?? "").trim();
  const input = {
    name: String(form.get("name") ?? ""),
    type,
    // A tapered bit's comes from its tip, angle and flute length; the form has no field for it.
    diameter: isTapered
      ? taperedDiameter({ tipDiameter, taperAngle, fluteLength })
      : numberField(form, "diameter"),
    fluteCount: numberField(form, "fluteCount"),
    fluteLength,
    cutDirection: isEndMill(type) ? (form.get("cutDirection") ?? null) : null,
    vAngle: isVBit ? numberField(form, "vAngle") : null,
    tipDiameter,
    taperAngle,
    spindleRpm: numberField(form, "spindleRpm"),
    feedRate: numberField(form, "feedRate"),
    plungeRate: numberField(form, "plungeRate"),
    plungeAngle: type === "drill" ? 90 : numberField(form, "plungeAngle"),
    stepDown: numberField(form, "stepDown"),
    notes: notes === "" ? null : notes,
    color: String(form.get("color") ?? "").toLowerCase(),
  };
  const result = Tool.safeParse(input);
  if (result.success) return { tool: result.data };

  return { errors: issuesToFormErrors<keyof Tool>(result.error.issues, input) };
}
