"use client";

import { useEffect, useSyncExternalStore } from "react";
import type { AutosaveStatus } from "@/stores/autosave";
import { useAutosaveApi } from "@/stores/workspace-stores";

/**
 * Autosaves the open project's document (ADR-0010) while mounted and returns
 * the save status. Leaving the page with unsaved changes asks for confirmation.
 */
export function useAutosave(): AutosaveStatus {
  const autosave = useAutosaveApi();
  const status = useSyncExternalStore(
    autosave.subscribe,
    () => autosave.status,
    () => autosave.status,
  );

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

  return status;
}
