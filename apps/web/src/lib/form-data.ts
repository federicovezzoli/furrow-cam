import { translate } from "./locale";

/** `undefined` on success, or a message to show the user. Unexpected failures still throw. */
export type ActionResult = { error: string } | undefined;

/** The message for an action called after the session expired, in the request's language. */
export const signedOut = () => translate("Errors.signedOut");

export { type FormErrors, issuesToFormErrors, numberField } from "@furrow/workspace/lib/form-data";
