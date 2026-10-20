---
"@furrow/cam-core": patch
---

SVG import now skips elements hidden through a stylesheet, such as a hidden layer in Illustrator's default export (`.st0{display:none}`), and shapes with `visibility: hidden`. It warns when a stylesheet hides elements with rules it can't apply.
