"use client";

import { useEffect } from "react";
import { belongsElsewhere } from "@/features/workspace/lib/keyboard-target";
import { undoShortcut } from "@/features/workspace/lib/undo-shortcut";
import { useDocumentStoreApi } from "@/features/workspace/providers/workspace-stores";

/**
 * Binds the document store's undo and redo to the keyboard while mounted.
 * Text fields keep their own undo, and an open dialog or menu owns the
 * keyboard: undoing behind it would change what the user can't see.
 */
export function useUndoShortcuts() {
  const store = useDocumentStoreApi();

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const action = undoShortcut(event);
      if (!action || event.defaultPrevented || belongsElsewhere(event.target)) return;
      event.preventDefault();
      store.getState()[action]();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [store]);
}
