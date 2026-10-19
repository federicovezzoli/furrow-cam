"use client";

import { useConfirmLeave, useSaveStatus } from "@furrow/workspace/hooks/use-autosave";
import { useEffect, useState } from "react";

/** Marks the copy of the page's history entry. */
const GUARD = "furrowLeaveGuard";

type GuardHistory = Pick<History, "pushState" | "back" | "state">;

/**
 * Asks before the browser's Back leaves the project while its changes can't
 * be saved (#254). The app router has no way to block a back navigation, so
 * once they can't, a copy of the page's history entry goes on top (`arm`):
 * Back lands on the page itself and asks there (`popState`), then goes back
 * for real or puts the copy back. The copy is never taken off by script (a
 * traversal is asynchronous and would race the next one): if saves went
 * through again meanwhile, reaching it goes straight on back. `inProject`
 * tells whether a path is one of the project's pages. `history` and
 * `pathname` are read when needed, so the guard can be made while rendering
 * on the server.
 */
export function createLeaveGuard({
  history,
  pathname,
  inProject,
  confirmLeave,
}: {
  history: () => GuardHistory;
  pathname: () => string;
  inProject: (path: string) => boolean;
  /** Whether to leave: asks while changes can't be saved, else true. */
  confirmLeave: () => boolean;
}) {
  let unsaved = false;
  let armed = false;
  let leaving = false;

  function arm() {
    if (armed || !unsaved) return;
    // Next.js copies its own state into the entry, so its router sees this page.
    history().pushState({ [GUARD]: true }, "");
    armed = true;
  }

  return {
    /** Whether the project's changes can't be saved now; the first time, arms the guard. */
    setUnsaved(value: boolean) {
      unsaved = value;
      arm();
    },
    popState() {
      if (leaving) {
        // Back on the entry before the copy, which may be another of the project's pages.
        leaving = false;
        if (inProject(pathname())) arm();
        return;
      }
      // Back onto the copy from a later page of the project: nothing is left yet.
      if (!armed || history().state?.[GUARD]) return;
      armed = false;
      if (confirmLeave()) {
        leaving = true;
        history().back();
      } else arm();
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
