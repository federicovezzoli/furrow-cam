import type { Locale } from "@furrow/ui/lib/locales";

/** The language the user picked, overriding `Accept-Language` (ADR-0054). Per browser, never on the account. */
export const LOCALE_COOKIE = "furrow-locale";

const ONE_YEAR = 60 * 60 * 24 * 365;

/** Remembers `locale` for the next request. Browser only. */
export function writeLocaleCookie(locale: Locale) {
  // biome-ignore lint/suspicious/noDocumentCookie: one cookie, written on a click; the Cookie Store API isn't in every browser yet.
  document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=${ONE_YEAR}; samesite=lax`;
}
