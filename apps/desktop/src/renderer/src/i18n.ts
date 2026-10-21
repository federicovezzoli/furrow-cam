import { translator } from "@furrow/ui/lib/i18n";
import { DEFAULT_LOCALE, type Locale } from "@furrow/ui/lib/locales";

let current = translator(DEFAULT_LOCALE);

/** Follows the language the app shows (ADR-0054); `main.tsx` sets it. */
export function setTranslatorLocale(locale: Locale) {
  current = translator(locale);
}

/** Translates outside React, e.g. an error or an alert, in the app's current language. */
export function t(...args: Parameters<typeof current>) {
  return current(...args);
}
