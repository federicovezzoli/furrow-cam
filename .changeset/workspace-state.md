---
"@furrow/web": minor
---

Add the workspace's client state (ADR-0010): document, workspace and toolpath stores created per open project, undo/redo of document changes through Immer patches with transactions that turn a continuous gesture into one undo step, Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z shortcuts (text fields keep their own undo), and autosave of the document one second after the last change, never mid-gesture. The top bar's save indicator now follows autosave and explains failed saves, and leaving the page with unsaved changes asks for confirmation.
