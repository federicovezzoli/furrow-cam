import { isLocale, type Locale, matchLocale, parseAcceptLanguage } from "@furrow/ui/lib/locales";

/** The language the user picked, overriding `Accept-Language` (ADR-0054). Per browser, never on the account. */
export const LOCALE_COOKIE = "furrow-locale";

const ONE_YEAR = 60 * 60 * 24 * 365;
const PICKED = new RegExp(`(?:^|;\\s*)${LOCALE_COOKIE}=([^;]*)`);

/**
 * The language for a request with these headers (ADR-0054): the picked one,
 * else the browser's, else English.
 */
export function requestLocale(headers: Headers): Locale {
  const picked = headers.get("cookie")?.match(PICKED)?.[1];
  if (isLocale(picked)) return picked;
  return matchLocale(parseAcceptLanguage(headers.get("accept-language")));
}

/**
 * The language in the browser, as `requestLocale` would pick it from this
 * browser's request; English on the server.
 */
export function browserLocale(): Locale {
  if (typeof document === "undefined") return "en";
  const picked = document.cookie.match(PICKED)?.[1];
  if (isLocale(picked)) return picked;
  return matchLocale(navigator.languages);
}

/** Remembers `locale` for the next request. Browser only. */
export function writeLocaleCookie(locale: Locale) {
  // biome-ignore lint/suspicious/noDocumentCookie: one cookie, written on a click; the Cookie Store API isn't in every browser yet.
  document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=${ONE_YEAR}; samesite=lax`;
}
