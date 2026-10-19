import { DEFAULT_SPIN_UP_DELAY, Machine } from "@furrow/document";
import { type FormErrors, issuesToFormErrors, numberField } from "../../lib/form-data";

/** Why the machine form's fields, or the form as a whole, couldn't be saved, for the user. */
export type MachineFormErrors = FormErrors<keyof Machine>;

/** Blank text keeps the post-processor's default. */
function gcodeField(form: FormData, key: string): string | null {
  const value = form.get(key);
  // Browsers submit textarea line breaks as CRLF; G-code files use LF.
  const text = typeof value === "string" ? value.replace(/\r\n?/g, "\n").trimEnd() : "";
  return text.trim() === "" ? null : text;
}

/**
 * Reads the machine form. A manual spindle ignores the speed fields, so
 * ticking it never leaves stale values behind. Its spin-up delay, hidden and
 * unused, is kept when valid and otherwise reset, so it never blocks a save
 * with an error nobody can see.
 */
export function parseMachineForm(form: FormData) {
  const manualSpindle = form.get("manualSpindle") === "on";
  const spinUpDelay = numberField(form, "spinUpDelay");
  const input = {
    name: String(form.get("name") ?? ""),
    workAreaX: numberField(form, "workAreaX"),
    workAreaY: numberField(form, "workAreaY"),
    workAreaZ: numberField(form, "workAreaZ"),
    maxFeedXY: numberField(form, "maxFeedXY"),
    maxFeedZ: numberField(form, "maxFeedZ"),
    spindleRpmMin: manualSpindle ? null : numberField(form, "spindleRpmMin"),
    spindleRpmMax: manualSpindle ? null : numberField(form, "spindleRpmMax"),
    spinUpDelay:
      manualSpindle && !Machine.shape.spinUpDelay.safeParse(spinUpDelay).success
        ? DEFAULT_SPIN_UP_DELAY
        : spinUpDelay,
    safeZ: numberField(form, "safeZ"),
    entryClearance: numberField(form, "entryClearance"),
    postProcessor: form.get("postProcessor"),
    programStart: gcodeField(form, "programStart"),
    programEnd: gcodeField(form, "programEnd"),
    operationStart: gcodeField(form, "operationStart"),
    toolChange: gcodeField(form, "toolChange"),
  };
  const result = Machine.safeParse(input);
  if (result.success) return { machine: result.data };

  // A blank spindle speed reads "Required" unless the spindle is manual.
  return { errors: issuesToFormErrors<keyof Machine>(result.error.issues, input) };
}
