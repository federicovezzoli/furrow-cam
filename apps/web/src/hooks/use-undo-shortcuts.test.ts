import { describe, expect, it } from "vitest";
import { undoShortcut } from "./use-undo-shortcuts";

const keys = { key: "z", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false };

describe("undoShortcut", () => {
  it("maps Ctrl/Cmd+Z to undo and Ctrl/Cmd+Shift+Z to redo", () => {
    expect(undoShortcut({ ...keys, ctrlKey: true })).toBe("undo");
    expect(undoShortcut({ ...keys, metaKey: true })).toBe("undo");
    expect(undoShortcut({ ...keys, key: "Z", ctrlKey: true, shiftKey: true })).toBe("redo");
    expect(undoShortcut({ ...keys, key: "z", metaKey: true, shiftKey: true })).toBe("redo");
  });

  it("ignores other keys and modifiers", () => {
    expect(undoShortcut(keys)).toBeNull();
    expect(undoShortcut({ ...keys, shiftKey: true })).toBeNull();
    expect(undoShortcut({ ...keys, ctrlKey: true, altKey: true })).toBeNull();
    expect(undoShortcut({ ...keys, key: "y", ctrlKey: true })).toBeNull();
  });
});
