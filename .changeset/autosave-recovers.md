---
"@furrow/workspace": patch
"@furrow/web": patch
---

Autosave no longer stops for the rest of the session after a refusal you can fix, such as being signed out, an edit the project can't store, or a model whose file isn't uploaded: it saves again with the next change, or when you come back to the window. A conflict with a save made elsewhere still stops it.
