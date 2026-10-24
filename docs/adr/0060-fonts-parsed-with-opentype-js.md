# ADR-0060: Fonts are parsed and laid out with opentype.js, behind one adapter

- **Status:** Proposed
- **Date:** 2026-10-24
- **Deciders:** Federico Vezzoli
- **Related:** PRD-0010 (T2, T4, T7), ADR-0004, ADR-0007, ADR-0015, ADR-0025, ADR-0059; #348

## Context

Text items (PRD-0010, ADR-0059) store their outlines, laid out from a font when the text is edited. Layout runs in the browser, in a worker (ADR-0004), so the font parser must run without a DOM. It must read TTF, OTF and WOFF files: the fonts the app ships (#349) and the ones users upload (#352). It must apply the font's kerning and give glyph outlines as curves, which the document keeps as cubics (ADR-0007). Its licence must be compatible with the project's MIT licence.

## Options considered

1. **[`opentype.js`](https://github.com/opentypejs/opentype.js) 2.0** (MIT, no dependencies): parses TrueType and CFF outlines, WOFF, the `kern` table and GPOS kerning, and gives each glyph's outline as move, line, quadratic and cubic commands. Its drawing helpers use a canvas or the DOM, but parsing and layout don't. About 245 KB minified. No WOFF2: Brotli would need another library.
2. **[`fontkit`](https://github.com/foliojs/fontkit)** (MIT): fuller shaping (ligatures, complex scripts) and WOFF2, but many dependencies (Brotli, Unicode tables) and a much larger bundle. Its shaping goes beyond what PRD-0010 asks: one line of Latin text with kerning.
3. **[`harfbuzzjs`](https://github.com/harfbuzz/harfbuzzjs)** (MIT, WebAssembly): the reference shaper, but loaded asynchronously as a WebAssembly module, with the costs ADR-0015 avoided for the geometry kernel.

## Decision

- Use **option 1, `opentype.js` 2.0**, in `@furrow/cam-core`. Only `src/text/font.ts` imports it (and the text tests, which build fonts in memory); Biome's `noRestrictedImports` enforces it, as for Clipper2 and Delaunator. `@types/opentype.js` describes 1.3; the members the adapter uses are unchanged in 2.0.
- `parseFont(bytes, singleStroke)` reads a font. `textPaths(font, settings)` lays a text item's line out with kerning, at its cap height (the OS/2 table's, else the top of its "H") and alignment, and places it: quadratics become cubics, as on SVG import.
- **Overlapping glyphs** (script fonts) are merged with the geometry kernel's union, so profiles go around them once and pockets don't cut the overlap twice. A merged outline is flattened at the default chord tolerance; glyphs that don't overlap keep their curves.
- **Single-stroke fonts** are flagged when parsed, as the app knows which of its fonts are (#349). Their contours become open paths, unless they end where they start, and are never merged: font formats close every contour, and engraving the closing line would cut a stroke the font doesn't have.
- A character the font lacks takes its advance but draws nothing, rather than the font's missing-glyph box.

## Consequences

- Layout needs no network and no DOM, in the web and the desktop app alike.
- WOFF2 fonts can't be read; an upload in WOFF2 must be converted first (#352).
- Text is laid out left to right without ligatures or complex-script shaping.
- Overlapping glyphs lose their curves to a 0.01 mm polyline, which V-carving and pockets flatten anyway.
