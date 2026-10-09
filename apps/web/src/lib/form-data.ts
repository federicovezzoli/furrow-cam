import type { z } from "zod";

/** `undefined` on success, or a message to show the user. Unexpected failures still throw. */
export type ActionResult = { error: string } | undefined;

/** Field name → message; `form` holds errors that aren't about one field. */
export type FormErrors<Field extends string> = Partial<Record<Field | "form", string>>;

export const SIGNED_OUT = "Your session has expired. Sign in again.";

/** A number input's value, or `null` when it's left blank. */
export function numberField(form: FormData, key: string): number | null {
  const value = form.get(key);
  if (typeof value !== "string" || value.trim() === "") return null;
  return Number(value);
}

/**
 * Turns validation issues into one message per field, the first one wins. Any
 * issue on a field whose `input` value is blank reads "Required", including
 * cross-field rules such as "required for V-bits".
 */
export function issuesToFormErrors<Field extends string>(
  issues: z.core.$ZodIssue[],
  input: Partial<Record<Field, unknown>>,
): FormErrors<Field> {
  const errors: FormErrors<Field> = {};
  for (const issue of issues) {
    const key = (issue.path[0] ?? "form") as Field | "form";
    const missing = key !== "form" && input[key] == null;
    errors[key] ??= missing ? "Required" : issue.message;
  }
  return errors;
}
