"use client";

import { useConfirmLeave, useSaveStatus } from "@furrow/workspace/hooks/use-autosave";
import { useEffect, useState } from "react";

type GuardHistory = Pick<History, "pushState" | "back">;

/** The part of the Navigation API the guard reads (TypeScript's DOM types lack `Navigation`). */
export type GuardNavigation = {
  readonly currentEntry: Pick<NavigationHistoryEntry, "index"> | null;
  entries(): Pick<NavigationHistoryEntry, "url" | "sameDocument">[];
};

/**
 * Asks before the browser's Back leaves the project while its changes can't
 * be saved (#254). The app router has no way to block a back navigation, so
 * once they can't, a copy of the page's history entry goes on top (`arm`):
 * Back lands on the page itself and asks there (`popState`), then goes back
 * for real or puts the copy back. The copy goes only on a page whose previous
 * entry is outside the project, in this document: Back to another of the
 * project's pages needs no asking, and Back to another document (or none) is
 * `beforeunload`'s. Entries are told apart by their Navigation API index, as
 * Next.js drops custom `history.state` on a refresh. The copy is never taken
 * off by script (a traversal is asynchronous and would race the next one): if
 * saves went through again meanwhile, reaching it goes straight on back.
 * `inProject` tells whether a path is one of the project's pages. `history`,
 * `navigation` and `pathname` are read when needed, so the guard can be made
 * while rendering on the server.
 */
export function createLeaveGuard({
  history,
  navigation,
  pathname,
  inProject,
  confirmLeave,
}: {
  history: () => GuardHistory;
  /** Undefined where the browser has no Navigation API: then only `beforeunload` asks. */
  navigation: () => GuardNavigation | undefined;
  pathname: () => string;
  inProject: (path: string) => boolean;
  /** Whether to leave: asks while changes can't be saved, else true. */
  confirmLeave: () => boolean;
}) {
  let unsaved = false;
  /** The copy's index, while it's in the history. */
  let copy: number | null = null;

  function arm() {
    const index = navigation()?.currentEntry?.index;
    if (copy !== null || !unsaved || index === undefined) return;
    const previous = navigation()?.entries()[index - 1];
    if (!previous?.sameDocument || !previous.url) return;
    if (inProject(new URL(previous.url).pathname)) return;
    // Next.js copies its own state into the entry, so its router sees this page.
    history().pushState({}, "");
    copy = index + 1;
  }

  return {
    /** Whether the project's changes can't be saved now; the first time, arms the guard. */
    setUnsaved(value: boolean) {
      unsaved = value;
      arm();
    },
    popState() {
      const index = navigation()?.currentEntry?.index;
      // Out of the project (by our own `back`, or Back past several entries): too late to ask.
      if (index === undefined || !inProject(pathname())) {
        copy = null;
        return;
      }
      // On the copy or a later page of the project: nothing is left yet.
      if (copy !== null && index >= copy) return;
      const onPage = copy === index + 1;
      copy = null;
      if (onPage && confirmLeave()) history().back();
      else arm();
    },
  };
}

/**
 * `createLeaveGuard` for the open project, whose pages are under `path`.
 * Links leaving the project ask through `useConfirmLeave` in the host's `Link`.
 */
export function LeaveGuard({ path }: { path: string }) {
  const { state } = useSaveStatus();
  const confirmLeave = useConfirmLeave();
  const [guard] = useState(() =>
    createLeaveGuard({
      history: () => window.history,
      navigation: () => (window as Window & { navigation?: GuardNavigation }).navigation,
      pathname: () => window.location.pathname,
      inProject: (pathname) => pathname === path || pathname.startsWith(`${path}/`),
      confirmLeave,
    }),
  );

  useEffect(() => {
    const onPopState = () => guard.popState();
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [guard]);

  useEffect(() => {
    guard.setUnsaved(state === "error" || state === "failed");
  }, [guard, state]);

  return null;
}
