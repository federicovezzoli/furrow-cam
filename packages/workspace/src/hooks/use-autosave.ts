"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
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
    const retry = () => autosave.retry();
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

/**
 * Asks whether to leave the open project while its changes can't be saved
 * (#254): autosave failed for good, or its last save failed and the one made
 * on leaving may too. Resolves to whether to go; nothing is asked while
 * saves go through. Hosts call it from their navigation away from the
 * project (ADR-0045), where `beforeunload` doesn't fire.
 */
export function useConfirmLeave(): () => boolean {
  const autosave = useAutosaveApi();
  return useCallback(
    () => mayLeave(autosave.status, (message) => window.confirm(message)),
    [autosave],
  );
}

/** A link's `onNavigate`: when the link `leaves` the project, asks through `useConfirmLeave` and stops it if told to stay. */
export function useLeaveNavigate(leaves = true): (event: { preventDefault(): void }) => void {
  const confirmLeave = useConfirmLeave();
  return useCallback(
    (event) => {
      if (leaves && !confirmLeave()) event.preventDefault();
    },
    [leaves, confirmLeave],
  );
}

/** Whether to leave the project with `status`, asking `confirm` only while changes can't be saved. */
export function mayLeave(status: AutosaveStatus, confirm: (message: string) => boolean): boolean {
  const { state, error } = status;
  if (state !== "error" && state !== "failed") return true;
  return confirm(
    `${error ?? "The project couldn't be saved."} Leave it anyway? Changes not saved will be lost; export the project first to keep them.`,
  );
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
