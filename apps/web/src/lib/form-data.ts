/** `undefined` on success, or a message to show the user. Unexpected failures still throw. */
export type ActionResult = { error: string } | undefined;

export const SIGNED_OUT = "Your session has expired. Sign in again.";

export { type FormErrors, issuesToFormErrors, numberField } from "@furrow/workspace/lib/form-data";
