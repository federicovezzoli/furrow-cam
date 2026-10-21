"use client";

import { useLocale } from "use-intl";
import { useIsClient } from "../hooks/use-is-client";

const OPTIONS: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" };

/**
 * `date` as `LocalDate` shows it, in `locale` (the browser's when left out).
 * Browser only: the server doesn't know the viewer's time zone.
 */
export function formatLocalDate(date: Date, locale?: string) {
  let format = formats.get(locale);
  if (!format) {
    format = new Intl.DateTimeFormat(locale, OPTIONS);
    formats.set(locale, format);
  }
  return format.format(date);
}

const formats = new Map<string | undefined, Intl.DateTimeFormat>();

/**
 * A date in the viewer's own time zone and the app's language. The server
 * doesn't know the time zone, so the text is filled in once the page runs in
 * the browser.
 */
export function LocalDate({ date }: { date: Date }) {
  const locale = useLocale();
  const isClient = useIsClient();
  return (
    <time dateTime={date.toISOString()}>{isClient ? formatLocalDate(date, locale) : null}</time>
  );
}
