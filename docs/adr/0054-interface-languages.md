# ADR-0054: Interface languages with use-intl, picked from the browser or the system

- **Status:** Proposed
- **Date:** 2026-10-21
- **Deciders:** Federico Vezzoli
- **Related:** ADR-0011, ADR-0013, ADR-0046, ADR-0048, ADR-0050; #294, #295

## Context

Furrow is English only. We want the interface in English, Italian, French and German (#294), picked automatically, with no language in URLs and an override for the rare case the detected language is wrong. The same strings are rendered by the web app's server and client components, by the shared `workspace` and `ui` packages (which can't import `next`, ADR-0046) and by the Electron renderer. The core packages build user-facing warnings inside workers, without React (ADR-0011).

## Options considered

1. **next-intl.** Routing, middleware and server helpers for Next.js. Its React APIs need `next`, so `workspace`, `ui` and the desktop app couldn't use them.
2. **use-intl**, next-intl's framework-agnostic core: `IntlProvider`, `useTranslations`, `createTranslator` for code outside React, ICU messages and `Intl` formatting. Works in every package that renders UI.
3. **A hand-rolled dictionary.** No dependency, but plurals, selects and number formatting would be ours to write.

## Decision

We will use option 2, `use-intl`.

- **Languages:** `en` (default and fallback), `it`, `fr`, `de`.
- **Catalogs** live in `packages/ui/src/messages/<locale>.json`, grouped by component namespace, shared by web, desktop, `workspace` and `ui`. `en.json` is the reference: the other catalogs are merged over it, so a missing key shows English, and a test fails when a catalog lacks a key `en` has. `@furrow/ui/lib/locales` holds the language list and matching with no React or catalogs, so the desktop main process can use it.
- **Web: detected on the server, no routes.** A `furrow-locale` cookie wins, else `Accept-Language` (matched on the primary subtag, `it-CH` → `it`), else `en`. With `cacheComponents` this is request data, so the root layout renders the app inside `<Suspense>` with no fallback. The language is resolved there and passed to an `IntlProvider`, so pages stream in the right language with no English flash. The `<html>` element stays in the static shell. An inline script in the same streamed chunk sets `<html lang>` before it paints. Server components translate with `getTranslator()`.
- **Desktop:** the main process takes the first supported language from `app.getPreferredSystemLanguages()`, then `app.getLocale()`, unless the user picked one. The pick is kept in `locale.json` in the data folder, apart from the renderer's `settings.json` (as `updates.json` is, ADR-0048). The renderer reads it through the preload API (`getLocale`, `setLocale`) before its first render and sets `<html lang>`.
- **Override:** a language picker next to the theme toggle (app header, workspace top bar, desktop app frame). On the web it writes the cookie and refreshes the server components. Client state, the open workspace included, is kept. It's remembered per browser or installation, never on the account, so ADR-0013 holds and guests get it too (ADR-0050).
- **Core packages return codes, not English** (`{ code, ...params }`), translated in `workspace` (#298). **Emails** use the same cookie and catalogs (#300).
- **Dates** stay formatted in the browser (`LocalDate`), which knows the viewer's time zone. use-intl's warning that no time zone is configured is therefore not reported.
- Units, G-code and the project document are unaffected: saved files contain no translated text.

## Consequences

- One library and one set of catalogs for every surface. ICU plurals replace the hand-rolled `plural()`.
- Every web page now depends on the request: pages that prerendered fully, such as `/privacy`, become partial prerenders whose content streams at request time.
- Translation keys aren't type-checked in `useTranslations` calls; a mistyped key renders the key and logs an error. The catalog test only checks that the catalogs agree with each other.
- Adding a language means one catalog, one entry in `LOCALES` and one in `LOCALE_NAMES`.
