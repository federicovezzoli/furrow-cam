/**
 * Whether a key press on `target` belongs to it rather than to a workspace
 * shortcut: form fields handle their own keys (undo, Esc ending a gesture),
 * and an open dialog or menu owns the keyboard.
 */
export function belongsElsewhere(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target.closest(
        'input, textarea, select, [role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]',
      ) !== null)
  );
}
