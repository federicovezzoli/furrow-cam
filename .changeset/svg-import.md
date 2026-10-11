---
"@furrow/cam-core": minor
"@furrow/web": minor
---

Import SVG files into the project geometry: paths, rects, circles, ellipses, lines, polylines and polygons, with transforms, `use` references and Inkscape, Illustrator and Affinity layer names. Sizes come from `width`/`height` and `viewBox`, and the user picks the DPI on import when the file's size is in pixels or missing, and the page's bottom-left corner lands on the stock's. Circles stay arcs and other curves stay cubics in the document, flattened at any tolerance for toolpaths; hidden elements are skipped, and text and images are reported.
