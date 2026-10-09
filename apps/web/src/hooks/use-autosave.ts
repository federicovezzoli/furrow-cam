"use client";

import { useEffect, useRef, useState } from "react";
import { saveProject } from "@/app/(app)/projects/actions";
import { type AutosaveStatus, createAutosave } from "@/stores/autosave";
import { useDocumentStoreApi } from "@/stores/workspace-stores";

/** Quiet time after the last change before the document is saved. */
export const AUTOSAVE_DELAY = 1000;

/**
 * Autosaves the open project's document (ADR-0010) and returns the save
 * status. `updatedAt` is the version the page was rendered with. Leaving the
 * page with unsaved changes asks for confirmation.
 */
export function useAutosave(projectId: string, updatedAt: Date): AutosaveStatus {
  const store = useDocumentStoreApi();
  const [status, setStatus] = useState<AutosaveStatus>({ state: "saved", savedAt: updatedAt });
  // Survives re-running the effect, so a new autosave continues from the last save.
  const savedAt = useRef(updatedAt);

  useEffect(() => {
    const autosave = createAutosave(store, {
      savedAt: savedAt.current,
      delay: AUTOSAVE_DELAY,
      save: (document, version) => saveProject(projectId, document, version),
      onStatus(next) {
        savedAt.current = next.savedAt;
        setStatus(next);
      },
    });

    function onBeforeUnload(event: BeforeUnloadEvent) {
      autosave.flush();
      if (autosave.status.state !== "saved") event.preventDefault();
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      autosave.dispose();
    };
  }, [store, projectId]);

  return status;
}
