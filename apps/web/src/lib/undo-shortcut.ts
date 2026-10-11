type ShortcutKeys = Pick<
  KeyboardEvent,
  "key" | "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey"
>;

/** Ctrl/Cmd+Z undoes, Ctrl/Cmd+Shift+Z redoes; anything else is `null`. */
export function undoShortcut(event: ShortcutKeys): "undo" | "redo" | null {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return null;
  // `key` follows Latin layouts (Z sits elsewhere on AZERTY); Shift makes it "Z". Other
  // scripts give another letter ("я" on Russian), so fall back to the key's position.
  const latin = /^[a-z]$/i.test(event.key);
  const isZ = latin ? event.key.toLowerCase() === "z" : event.code === "KeyZ";
  if (!isZ) return null;
  return event.shiftKey ? "redo" : "undo";
}
