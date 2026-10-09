"use client";

import { useEffect } from "react";
import { undoShortcut } from "@/lib/undo-shortcut";
import { useDocumentStoreApi } from "@/stores/workspace-stores";

/**
 * Text fields keep their own undo, and an open dialog or menu owns the
 * keyboard: undoing behind it would change what the user can't see.
 */
function belongsElsewhere(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target.closest(
        'input, textarea, select, [role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]',
      ) !== null)
  );
}

/** Binds the document store's undo and redo to the keyboard while mounted. */
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
