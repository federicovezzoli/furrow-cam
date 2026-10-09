"use client";

import { useSyncExternalStore } from "react";

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

const subscribe = () => () => {};

/**
 * A date in the viewer's own time zone. The server doesn't know it, so the
 * text is filled in once the page runs in the browser.
 */
export function LocalDate({ date }: { date: Date }) {
  const text = useSyncExternalStore(
    subscribe,
    () => dateFormat.format(date),
    () => null,
  );
  return <time dateTime={date.toISOString()}>{text}</time>;
}
