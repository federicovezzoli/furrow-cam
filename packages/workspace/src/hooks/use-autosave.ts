"use client";

import { useDialogs } from "@furrow/ui/components/dialogs";
import { formatMessage } from "@furrow/ui/lib/i18n";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { useTranslations } from "use-intl";
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
 * on leaving may too. Gives whether to go: `true` at once while saves go
 * through, else a promise of the user's answer. Hosts call it from their
 * navigation away from the project (ADR-0045), where `beforeunload` doesn't
 * fire.
 */
export function useConfirmLeave(): () => true | Promise<boolean> {
  const autosave = useAutosaveApi();
  const t = useTranslations();
  const { confirm } = useDialogs();
  return useCallback(
    () =>
      mayLeave(autosave.status, (error) =>
        confirm(
          t("Shell.leaveAnyway", {
            error: formatMessage(t, error ?? { code: "workspace.offline" }),
          }),
        ),
      ),
    [autosave, t, confirm],
  );
}

/**
 * A link's `onNavigate`: when the link `leaves` the project and
 * `useConfirmLeave` has to ask, stops it, then calls `navigate` (the same
 * navigation, past the link) if told to go.
 */
export function useLeaveNavigate(
  navigate: () => void,
  leaves = true,
): (event: { preventDefault(): void }) => void {
  const confirmLeave = useConfirmLeave();
  return (event) => {
    if (!leaves) return;
    const go = confirmLeave();
    if (go === true) return;
    event.preventDefault();
    void go.then((yes) => yes && navigate());
  };
}

/** Whether to leave the project with `status`, asking `confirm` only while changes can't be saved. */
export function mayLeave(
  status: AutosaveStatus,
  confirm: (error: AutosaveStatus["error"]) => Promise<boolean>,
): true | Promise<boolean> {
  const { state, error } = status;
  if (state !== "error" && state !== "failed") return true;
  return confirm(error);
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
