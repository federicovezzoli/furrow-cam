"use client";

import type * as React from "react";
import { createContext, useContext, useMemo } from "react";
import { IntlProvider } from "use-intl";
import { messagesFor, onIntlError } from "../lib/i18n";
import type { Locale } from "../lib/locales";

const ChangeLocale = createContext<((locale: Locale) => void) | null>(null);

/**
 * The interface language (ADR-0054): `locale`'s messages for `useTranslations`
 * below it, and `onLocaleChange` for the language picker, which the app
 * implements (a cookie on the web, the main process's settings on desktop).
 */
export function LocaleProvider({
  locale,
  onLocaleChange,
  children,
}: {
  locale: Locale;
  onLocaleChange: (locale: Locale) => void;
  children: React.ReactNode;
}) {
  const messages = useMemo(() => messagesFor(locale), [locale]);
  return (
    <IntlProvider locale={locale} messages={messages} onError={onIntlError}>
      <ChangeLocale.Provider value={onLocaleChange}>{children}</ChangeLocale.Provider>
    </IntlProvider>
  );
}

/** Changes the interface language; throws outside a `LocaleProvider`. */
export function useChangeLocale() {
  const change = useContext(ChangeLocale);
  if (!change) throw new Error("useChangeLocale needs a LocaleProvider");
  return change;
}
