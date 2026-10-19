---
"@furrow/document": patch
"@furrow/cam-core": patch
"@furrow/workspace": patch
---

Profiles, pockets and 3D roughing and finishing no longer take drill bits, which snap when moved sideways through the stock: the tool picker disables them, and new operations start with a bit that cuts sideways. A project saved with a drill bit on one of these operations still opens; the operation shows why it has no toolpath until you pick another bit.
