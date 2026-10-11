import { describe, expect, it } from "vitest";
import { undoShortcut } from "./undo-shortcut";

const keys = {
  key: "z",
  code: "KeyZ",
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
};

describe("undoShortcut", () => {
  it("maps Ctrl/Cmd+Z to undo and Ctrl/Cmd+Shift+Z to redo", () => {
    expect(undoShortcut({ ...keys, ctrlKey: true })).toBe("undo");
    expect(undoShortcut({ ...keys, metaKey: true })).toBe("undo");
    expect(undoShortcut({ ...keys, key: "Z", ctrlKey: true, shiftKey: true })).toBe("redo");
    expect(undoShortcut({ ...keys, key: "z", metaKey: true, shiftKey: true })).toBe("redo");
  });

  it("uses the key's position on non-Latin layouts", () => {
    expect(undoShortcut({ ...keys, key: "я", ctrlKey: true })).toBe("undo");
    expect(undoShortcut({ ...keys, key: "Я", ctrlKey: true, shiftKey: true })).toBe("redo");
    expect(undoShortcut({ ...keys, key: "ч", code: "KeyX", ctrlKey: true })).toBeNull();
  });

  it("follows the letter on Latin layouts", () => {
    // AZERTY: the Z key is where QWERTY has W, and QWERTY's Z position types W.
    expect(undoShortcut({ ...keys, code: "KeyW", ctrlKey: true })).toBe("undo");
    expect(undoShortcut({ ...keys, key: "w", code: "KeyZ", ctrlKey: true })).toBeNull();
  });

  it("ignores other keys and modifiers", () => {
    expect(undoShortcut(keys)).toBeNull();
    expect(undoShortcut({ ...keys, shiftKey: true })).toBeNull();
    expect(undoShortcut({ ...keys, ctrlKey: true, altKey: true })).toBeNull();
    expect(undoShortcut({ ...keys, key: "y", ctrlKey: true })).toBeNull();
  });
});
