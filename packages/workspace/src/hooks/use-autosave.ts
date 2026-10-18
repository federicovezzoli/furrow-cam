"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useAutosaveApi } from "../providers/workspace-stores";
import type { AutosaveStatus } from "../stores/autosave";

/**
 * Autosaves the open project's document (ADR-0010) while mounted. Leaving the
 * page with unsaved changes asks for confirmation. `useSaveStatus` reads how
 * it's going.
 */
export function useAutosave() {
  const autosave = useAutosaveApi();

  useEffect(() => {
    const stop = autosave.start();
    function onBeforeUnload(event: BeforeUnloadEvent) {
      autosave.flush();
      if (autosave.status.state !== "saved") event.preventDefault();
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
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
