"use client";

import { useEffect } from "react";
import { useDocumentStoreApi } from "@/stores/workspace-stores";

type ShortcutKeys = Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">;

/** Ctrl/Cmd+Z undoes, Ctrl/Cmd+Shift+Z redoes; anything else is `null`. */
export function undoShortcut(event: ShortcutKeys): "undo" | "redo" | null {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return null;
  // `key` follows the keyboard layout (Z sits elsewhere on AZERTY); Shift makes it "Z".
  if (event.key.toLowerCase() !== "z") return null;
  return event.shiftKey ? "redo" : "undo";
}

/** Text fields keep their own undo. */
function isTextField(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || target.matches("input, textarea, select"))
  );
}

/** Binds the document store's undo and redo to the keyboard while mounted. */
export function useUndoShortcuts() {
  const store = useDocumentStoreApi();

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const action = undoShortcut(event);
      if (!action || isTextField(event.target)) return;
      event.preventDefault();
      store.getState()[action]();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [store]);
}
