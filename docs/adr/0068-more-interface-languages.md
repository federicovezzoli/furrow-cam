# ADR-0068: Seven more interface languages, with one variant each

- **Status:** Proposed
- **Date:** 2026-10-30
- **Deciders:** Federico Vezzoli
- **Related:** ADR-0054; #413

## Context

ADR-0054 offers the interface in English, Italian, French and German. We want Spanish, Dutch, Portuguese, Greek, Turkish, Chinese and Japanese too (#413). Languages are matched on the primary subtag (`es-MX` → `es`). This means each language gets a single catalog, even where it has variants that differ: Brazilian and European Portuguese, and Simplified and Traditional Chinese. The interface font, JetBrains Mono, covers Latin, Latin Extended and Greek but not Chinese or Japanese.

## Options considered

1. **One catalog per language, in its most widely used variant.** Matching stays on the primary subtag.
2. **Regional catalogs** (`pt-BR` and `pt-PT`, `zh-Hans` and `zh-Hant`). Matching would need full tags with a fallback chain, and twice the catalogs to keep translated.
3. **Bundle a CJK font.** It would add several megabytes to the web app and the desktop installer.

## Decision

We will use option 1, and leave Chinese and Japanese to the system's font fallback.

- **Languages:** ADR-0054's `en`, `it`, `fr`, `de`, plus `es`, `nl`, `pt`, `el`, `tr`, `zh`, `ja`, each with a catalog in `packages/ui/src/messages/<locale>.json`.
- **Variants:** `pt` is Brazilian Portuguese and `zh` is Simplified Chinese (`简体中文` in the picker). `pt-PT` and `zh-TW` get them too.
- **Fonts:** JetBrains Mono has no CJK glyphs, and the font stacks end in `monospace`, so Chinese and Japanese characters come from whichever font the system or browser falls back to for them. A new text item starts as `Text` in these two languages, because its default font is JetBrains Mono too. On the web, `next/font` still serves the Greek and Latin Extended faces through `unicode-range`, and only the Latin one is preloaded.
- Decimal separators keep following `Intl`: Spanish, Dutch, Portuguese, Greek and Turkish use a comma, Chinese and Japanese a point.

## Consequences

- Eleven catalogs to keep complete. The catalog tests fail when one lacks a key, or names an argument or tag differently from English.
- European Portuguese and Traditional Chinese readers see the other variant. Adding one later means option 2 for that language.
- Chinese and Japanese text looks different from the rest of the interface, and its width varies with the system font.
