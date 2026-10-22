# ADR-0057: What the server returns to the browser carries message keys, not text

- **Status:** Proposed
- **Date:** 2026-10-22
- **Deciders:** Federico Vezzoli
- **Related:** ADR-0054; #296, #307.

## Context

ADR-0054 has the core packages return `Message` codes that the UI translates. The web app's server actions still translated their own errors: each one read the request headers for the language and built a translator, some of them inside row-locked transactions. The browser already knows the language it shows.

## Decision

- **One rule for the server:** anything returned to a client component, a server action's result or a `server.ts` helper's that an action passes on, carries messages, not text. What the server renders itself (pages, metadata, emails, route handlers) keeps translating with `getTranslator()`, once per render, never inside a transaction.
- **Key messages:** the app's own messages are `KeyMessage`s, `{ key, values? }`, with the full catalog key (`Projects.notFound`), type-checked against the English catalog. `Translatable` is `string | Message | KeyMessage`, and `formatMessage` looks a key message up as it is and a core `Message` under `Core`. Messages in `values` are translated too, and a list of them is shown one per line, so an error can nest its reason (`Projects.saveFailed` with the validation issues).
- **Stored text stays translated:** names and labels the server stores, such as "Imported project" or an automatic version's label, are data and are written in the request's language.

## Consequences

- Server actions do no language lookup; their tests assert keys, not English.
- The client renders every action error through `useFormatMessage`, `FormError` or `formatMessage`. A raw `error` shown without them would print an object, which the type of `ActionResult` (`Translatable`) points out everywhere except `window.alert`, which takes anything.
