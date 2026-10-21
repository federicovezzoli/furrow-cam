import { translator } from "@furrow/ui/lib/i18n";
import { DEFAULT_LOCALE, isLocale } from "@furrow/ui/lib/locales";

/**
 * Translates in the browser outside React (errors from storage, imports), in
 * the language the page shows: `<html lang>` always follows it (ADR-0054).
 */
export function clientTranslator() {
  const lang = typeof document === "undefined" ? null : document.documentElement.lang;
  return translator(isLocale(lang) ? lang : DEFAULT_LOCALE);
}
