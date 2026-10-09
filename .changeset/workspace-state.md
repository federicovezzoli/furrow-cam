---
"@furrow/web": minor
---

Add the workspace's client state (ADR-0010): document, workspace and toolpath stores created per open project, undo/redo of document changes through Immer patches with transactions that turn a continuous gesture into one undo step, Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z shortcuts (text fields, dialogs and menus keep the keys), and autosave of the document one second after the last change, never mid-gesture. Changes made while a save is running are saved after it, including when leaving the workspace, and undoing back to the saved state counts as saved. The top bar's save indicator follows autosave; if the server refuses a save (for example because the project was changed elsewhere), autosave stops and a banner explains why. Exporting from the workspace downloads the document as it is on screen, unsaved changes included. Leaving the page with unsaved changes asks for confirmation.
