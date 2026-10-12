---
"@furrow/cam-core": patch
---

SVG import treats a subpath that ends where it started (within the 0.001 mm geometry tolerance) as closed, even without a `Z`. Editors such as Inkscape often write closed outlines this way, and profiles and pockets skipped them as open paths.
