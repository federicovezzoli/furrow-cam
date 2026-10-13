# ADR-0020: Page-view analytics with GoatCounter

- **Status:** Proposed
- **Date:** 2026-10-13
- **Deciders:** Federico Vezzoli
- **Related:** ADR-0005, ADR-0013

## Context

We do not know how the app is used: which pages people visit, where they come from, or whether anyone reaches the workspace. Basic page-view counts would answer that.

ADR-0013 limits the personal data we collect to the email address and requires a new ADR for any feature that needs more. Every analytics tool processes some request data, at least as a third party, so adding one falls under that rule. We also want to avoid a cookie consent banner.

## Options considered

1. **Google Analytics or similar**: rich reports. Sets cookies and persistent identifiers, needs a consent banner in the EU, and sends visitor data to an ad company. Contradicts ADR-0013.
2. **Vercel Web Analytics**: no extra third party (ADR-0005). Page-view counts are limited on the free plan and the data stays tied to the hosting provider.
3. **Plausible, Umami**: privacy-friendly and cookieless. Hosted plans are paid; self-hosting means running another service and database.
4. **GoatCounter**: open source, cookieless, free hosted service for non-commercial use, or self-hosted. No persistent identifiers and no IP storage.
5. **No analytics**: no data processed. We stay blind to usage.

## Decision

We will count page views with **GoatCounter**, loaded only when `NEXT_PUBLIC_GOATCOUNTER_URL` (the `/count` endpoint, hosted or self-hosted) is set. It is unset in development and CI, so nothing is counted there; GoatCounter also skips `localhost` by default.

What GoatCounter receives for each page view:

- the **route pattern** as path and title, e.g. `/projects/[id]`, never the concrete URL: no record IDs, query strings or hashes;
- the **referrer**, user agent and screen size;
- the visitor's **IP address**, used for the country lookup and, with the user agent, for a session hash that rotates daily. GoatCounter does not store the IP address.

GoatCounter sets no cookies and stores nothing in the browser, so no consent banner is needed. We record page views only: no custom events (e.g. G-code export) without a new decision.

The App Router navigates client-side, so `count.js`'s own count on load (which only sees the first page) is turned off with `no_onload`; a client component in the root layout counts every navigation, the first one included, exactly once.

## Consequences

- We get aggregate usage numbers: pages, referrers, browsers, countries.
- No data is tied to an account, and record IDs never leave our servers.
- GoatCounter becomes a third party processing request data, alongside Vercel and Resend (ADR-0013 Consequences); the privacy policy, once written, must mention it.
- Visitors who block third-party scripts are not counted; the numbers are a lower bound.
- Choosing hosted goatcounter.com or a self-hosted instance is a deployment setting, not a code change.
