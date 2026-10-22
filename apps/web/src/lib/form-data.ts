import type { KeyMessage, Translatable } from "@furrow/ui/lib/i18n";

/** `undefined` on success, or a message for the client to show (ADR-0054). Unexpected failures still throw. */
export type ActionResult = { error: Translatable } | undefined;

/** The message for an action called after the session expired. */
export const signedOut: KeyMessage = { key: "Errors.signedOut" };

export { type FormErrors, issuesToFormErrors, numberField } from "@furrow/workspace/lib/form-data";
