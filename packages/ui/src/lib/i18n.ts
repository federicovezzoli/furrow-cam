import { createTranslator, type IntlError, IntlErrorCode } from "use-intl/core";
import de from "../messages/de.json";
import en from "../messages/en.json";
import fr from "../messages/fr.json";
import it from "../messages/it.json";
import type { Locale } from "./locales";

/** The messages, keyed as English has them: every key starts there. */
export type Messages = typeof en;
/** A catalog as read: nested namespaces of ICU messages. */
export type Catalog = { [key: string]: string | Catalog };

/** The message catalogs (ADR-0054). */
export const CATALOGS: Record<Locale, Catalog> = { en, it, fr, de };

/** `locale`'s messages, with English for any key its catalog lacks. */
export function messagesFor(locale: Locale): Messages {
  return withFallback(CATALOGS[locale], en) as Messages;
}

function withFallback(messages: Catalog, fallback: Catalog): Catalog {
  const merged: Catalog = { ...fallback };
  for (const [key, value] of Object.entries(messages)) {
    const base = fallback[key];
    merged[key] =
      typeof value === "object" && typeof base === "object" ? withFallback(value, base) : value;
  }
  return merged;
}

/** Reports use-intl's errors, except the time zone it can't know on the server. */
export function onIntlError(error: IntlError) {
  // Dates are formatted in the browser (`LocalDate`), which knows the viewer's time zone.
  if (error.code !== IntlErrorCode.ENVIRONMENT_FALLBACK) console.error(error);
}

/** A translator outside React, e.g. in a server component. */
export function translator(locale: Locale) {
  return createTranslator({ locale, messages: messagesFor(locale), onError: onIntlError });
}
