"use client";

import { useIsClient } from "@/hooks/use-is-client";

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

/**
 * A date in the viewer's own time zone. The server doesn't know it, so the
 * text is filled in once the page runs in the browser.
 */
export function LocalDate({ date }: { date: Date }) {
  const isClient = useIsClient();
  return <time dateTime={date.toISOString()}>{isClient ? dateFormat.format(date) : null}</time>;
}
