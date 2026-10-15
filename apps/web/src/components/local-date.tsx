"use client";

import { useIsClient } from "@/hooks/use-is-client";

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

/** `date` as `LocalDate` shows it. Browser only: the server doesn't know the viewer's time zone. */
export function formatLocalDate(date: Date) {
  return dateFormat.format(date);
}

/**
 * A date in the viewer's own time zone. The server doesn't know it, so the
 * text is filled in once the page runs in the browser.
 */
export function LocalDate({ date }: { date: Date }) {
  const isClient = useIsClient();
  return <time dateTime={date.toISOString()}>{isClient ? formatLocalDate(date) : null}</time>;
}
