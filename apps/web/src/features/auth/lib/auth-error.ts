import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "./password-policy";

/** A Better Auth error as its client returns it. */
type AuthError = { code?: string; status?: number };

const KNOWN = new Set([
  "INVALID_EMAIL_OR_PASSWORD",
  "INVALID_PASSWORD",
  "INVALID_EMAIL",
  "INVALID_TOKEN",
  "TOKEN_EXPIRED",
  "EMAIL_NOT_VERIFIED",
  "PASSWORD_TOO_SHORT",
  "PASSWORD_TOO_LONG",
  "USER_ALREADY_EXISTS",
  "PASSWORD_BREACHED",
  "PASSWORD_REQUIRED",
  "SESSION_EXPIRED",
]);

/**
 * The message for a Better Auth error in the app's language (ADR-0054), from
 * its code: Better Auth's own messages are English. `fallback` is the key of
 * the form's message for anything else.
 */
export function authErrorMessage(
  t: (key: string, values?: Record<string, number>) => string,
  error: AuthError,
  fallback: "signIn" | "signUp" | "reset" | "deleteAccount" | "generic",
): string {
  if (error.status === 429) return t("TOO_MANY_REQUESTS");
  const code =
    error.code === "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL" ? "USER_ALREADY_EXISTS" : error.code;
  if (code && KNOWN.has(code)) {
    return t(code, { min: PASSWORD_MIN_LENGTH, max: PASSWORD_MAX_LENGTH });
  }
  return t(fallback);
}
