import { type Message, MessageError } from "@furrow/document";
import {
  createTranslator,
  type IntlError,
  IntlErrorCode,
  type MessageKeys,
  type NestedKeyOf,
} from "use-intl/core";
import de from "../messages/de.json";
import el from "../messages/el.json";
import en from "../messages/en.json";
import es from "../messages/es.json";
import fr from "../messages/fr.json";
import it from "../messages/it.json";
import ja from "../messages/ja.json";
import nl from "../messages/nl.json";
import pt from "../messages/pt.json";
import tr from "../messages/tr.json";
import zh from "../messages/zh.json";
import type { Locale } from "./locales";

/** The messages, keyed as English has them: every key starts there. */
export type Messages = typeof en;
/** A catalog as read: nested namespaces of ICU messages. */
export type Catalog = { [key: string]: string | Catalog };

/** The message catalogs (ADR-0054). */
export const CATALOGS: Record<Locale, Catalog> = { en, it, fr, de, es, nl, pt, el, tr, zh, ja };

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

/**
 * One of the apps' own messages by its full catalog key, e.g. a server
 * action's error (ADR-0054). Messages in `values` are translated too, and a
 * list of them is shown one per line.
 */
export type KeyMessage = {
  key: MessageKeys<Messages, NestedKeyOf<Messages>>;
  values?: Record<string, string | number | Translatable | Translatable[]>;
};

/** Text to show: already translated, a core package's message, or an app's (ADR-0054). */
export type Translatable = string | Message | KeyMessage;

/** `message` in `t`'s language: a core package's code under `Core`, a key, or text as it is. */
export function formatMessage(t: AnyTranslator, message: Translatable): string {
  if (typeof message === "string") return message;
  if ("code" in message) return t(`Core.${message.code}`, message.values);
  const values = message.values && Object.entries(message.values);
  return t(
    message.key,
    values &&
      Object.fromEntries(
        values.map(([name, value]) => [
          name,
          typeof value === "number"
            ? value
            : Array.isArray(value)
              ? value.map((line) => formatMessage(t, line)).join("\n")
              : formatMessage(t, value),
        ]),
      ),
  );
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
 * What `error` says for the user: a core package's error translated, else
 * its own text, else `fallback` for anything thrown that isn't an `Error`.
 */
export function errorText(t: AnyTranslator, error: unknown, fallback: string): string {
  if (error instanceof MessageError) {
    return formatWarning(t, { operation: error.operation, message: error.detail });
  }
  return error instanceof Error ? error.message : fallback;
}
