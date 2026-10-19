"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useAutosaveApi } from "../providers/workspace-stores";
import type { AutosaveStatus } from "../stores/autosave";

/**
 * Autosaves the open project's document (ADR-0010) while mounted. Leaving the
 * page with unsaved changes asks for confirmation. After a save that can be
 * retried failed, coming back to the window or online tries again, e.g. once
 * the user signed in again in another tab. `useSaveStatus` reads how it's
 * going.
 */
export function useAutosave() {
  const autosave = useAutosaveApi();

  useEffect(() => {
    const stop = autosave.start();
    function onBeforeUnload(event: BeforeUnloadEvent) {
      autosave.flush();
      if (autosave.status.state !== "saved") event.preventDefault();
    }
    function retry() {
      if (autosave.status.state === "error") autosave.flush();
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("focus", retry);
    window.addEventListener("online", retry);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("focus", retry);
      window.removeEventListener("online", retry);
      stop();
    };
  }, [autosave]);
}

/** The open project's save status. */
export function useSaveStatus(): AutosaveStatus {
  const autosave = useAutosaveApi();
  return useSyncExternalStore(
    autosave.subscribe,
    () => autosave.status,
    () => autosave.status,
  );
}
