# ADR-0052: Anonymous usage and error tracking with PostHog

- **Status:** Proposed
- **Date:** 2026-10-20
- **Deciders:** Federico Vezzoli
- **Related:** ADR-0013, ADR-0020, ADR-0044, ADR-0048, ADR-0050, ADR-0051; PRD-0007; #283

## Context

We learn about crashes only when someone files a bug report (ADR-0051), and GoatCounter (ADR-0020) tells us which pages are visited but not whether people import drawings, add operations or export G-code. We want error reports and a few product events, on the web and in the desktop app.

That touches several decisions. ADR-0013 keeps the personal data we hold to the email address. ADR-0020 sends page views without a third-party script, because such scripts send query strings (a password-reset token) and full referrers, and allows no custom events without a new decision. The desktop app makes no requests except the update check the user agreed to (ADR-0044, ADR-0048, PRD-0007 D2). Guests' projects never reach us (ADR-0050).

## Options considered

1. **PostHog**, cookieless: page views, named events and errors in one tool, an EU cloud, and SDKs for the browser and Node. Its browser SDK loads extensions from PostHog's servers unless the `no-external` build is used, and captures URLs, titles and referrers by default.
2. **Sentry for errors plus GoatCounter for page views**: two processors, and still no product events.
3. **Our own endpoint**: we would store IP addresses and error reports ourselves.
4. **Keep GoatCounter only**: no errors, no events.

## Decision

We will use option 1, with PostHog's EU cloud, replacing GoatCounter. Both apps send through PostHog's managed reverse proxy on a subdomain of ours, set as `NEXT_PUBLIC_POSTHOG_HOST` on the web and `POSTHOG_HOST` in desktop builds; unset, they send to `eu.i.posthog.com`. The proxy keeps requests first-party, so fewer are blocked, and still forwards to PostHog.

- **Cookieless and anonymous.** The web app runs PostHog in `cookieless_mode: "always"`: nothing is stored in the browser, PostHog derives a daily-rotating hash from the request on its servers, and no consent banner is needed. We never call `identify()`: no event is linked to an account or an email. The desktop app uses a random ID per launch, kept in memory. The PostHog project has cookieless mode and "discard client IP data" turned on.
- **No third-party code.** The web app bundles `posthog-js/no-external`, which never loads scripts from PostHog. Autocapture, session replay, surveys, feature flags and remote config are off.
- **What is sent.** Page views carry the route pattern (e.g. `/projects/[id]`), as in ADR-0020: every URL, title and referrer property PostHog adds is dropped, and the first page view carries only an external referrer's origin. The events, and nothing else about the user's work:
  - `project_created`
  - `file_imported`, with the format (`svg`, `dxf`, `stl`)
  - `operation_added`, with the operation type
  - `gcode_exported`, with the post-processor
  - `signed_up`
  - `guest_imported`, with the number of projects
- **Errors.** Uncaught errors and unhandled rejections in the page, errors caught by the web app's error boundaries, and, on desktop, uncaught errors in the main process. A report carries the error's type, its message cut to 200 characters with file paths replaced, and its stack with paths reduced to the app's own files (no user folder) and URLs without query strings. Errors a worker reports as an operation's toolpath error are user feedback, not reports.
- **Desktop is opt-in.** On first start, a dialog asks whether to send anonymous usage statistics and error reports. The answer is kept in `telemetry.json` in the data folder, and *Help → Send Usage Statistics and Error Reports* changes it. Nothing is sent before the user agrees. The main process sends through `posthog-node` with its own in-memory session, whose request filter lets through only that host; the renderer hands events and errors to it over IPC, and its CSP and session still block every request. A build without a PostHog key never asks.
- **Server.** Nothing is sent from the server: it only authenticates and stores, and Vercel's logs hold its errors.

## Consequences

- We see crashes and how the workspace is used, without cookies or a banner, and no data is tied to an account.
- PostHog replaces GoatCounter as the analytics processor; the privacy policy says what it receives, on the web and in the desktop app. ADR-0020 is superseded.
- Guests are counted like everyone else; their projects still never reach us.
- PRD-0007 D2 allows one more request, with the user's consent (D13).
- Cookieless mode can't tell returning visitors apart across days: no retention or funnels across visits.
- Visitors whose blockers stop requests to PostHog are not counted.
- An error message may still contain words from the user's work (e.g. a file name inside a parser error); cutting it to 200 characters limits that, and the desktop sends it only with consent.
