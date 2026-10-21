import type { Message } from "@furrow/document";
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

const merged = new Map<Locale, Messages>();

/** `locale`'s messages, with English for any key its catalog lacks. */
export function messagesFor(locale: Locale): Messages {
  let messages = merged.get(locale);
  if (!messages) {
    messages = withFallback(CATALOGS[locale], en) as Messages;
    merged.set(locale, messages);
  }
  return messages;
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

export type Translator = ReturnType<typeof translator>;

const translators = new Map<Locale, ReturnType<typeof createTranslatorFor>>();

function createTranslatorFor(locale: Locale) {
  return createTranslator({ locale, messages: messagesFor(locale), onError: onIntlError });
}

/** A translator outside React, e.g. in a server component; one per language, built once. */
export function translator(locale: Locale) {
  let t = translators.get(locale);
  if (!t) {
    t = createTranslatorFor(locale);
    translators.set(locale, t);
  }
  return t;
}

/** Any translator, from `translator` or `useTranslations`, without a namespace. */
// biome-ignore lint/suspicious/noExplicitAny: translators are typed by their catalog keys; these helpers build keys at runtime.
type AnyTranslator = (key: any, values?: any) => string;

/** Text to show: already translated, or a core package's message (ADR-0054). */
export type Translatable = string | Message;

/** `message` in `t`'s language: a core package's code under `Core`, or text as it is. */
export function formatMessage(t: AnyTranslator, message: Translatable): string {
  return typeof message === "string" ? message : t(`Core.${message.code}`, message.values);
}

/** A warning about the program, after the operation it is about, if any. */
export function formatWarning(
  t: AnyTranslator,
  warning: { operation?: string; message: Translatable },
): string {
  const message = formatMessage(t, warning.message);
  return warning.operation === undefined
    ? message
    : t("Core.withOperation", { operation: warning.operation, message });
}

/**
 * What `error` says for the user: a core package's error translated from its
 * `detail`, else `fallback` (its text is English, for developers).
 */
export function errorText(t: AnyTranslator, error: unknown, fallback: string): string {
  const detail = (error as { detail?: unknown } | null)?.detail;
  if (isMessage(detail)) return formatMessage(t, detail);
  if (typeof detail === "object" && detail !== null && "message" in detail) {
    const warning = detail as { operation?: string; message: unknown };
    if (isMessage(warning.message))
      return formatWarning(t, { ...warning, message: warning.message });
  }
  return fallback;
}

function isMessage(value: unknown): value is Message {
  return typeof value === "object" && value !== null && typeof (value as Message).code === "string";
}
