# ADR-0036: The account remembers when each guided tour was seen

- **Status:** Proposed
- **Date:** 2026-10-16
- **Deciders:** Federico Vezzoli
- **Related:** PRD-0001 (R22), ADR-0013, ADR-0006; issue #138

## Context

The guided tours (R22) show once per account: the app tour on the first visit to the project list, the workspace tour in the first project opened. A user who finished or skipped a tour shouldn't see it again on another device or browser, so where that is remembered matters.

ADR-0013 keeps the email address as the only identifying data we collect, and asks for a new ADR for any new personal data. When a user finished a tour is not identifying, but it is data about the use of the app linked to an account, so it belongs in the privacy policy.

## Options considered

1. **Browser storage**: nothing on the server, but the tour comes back on every new device, browser or private window, and after clearing site data.
2. **Two nullable timestamps on `User`**: `appTourDoneAt` and `workspaceTourDoneAt`, declared as Better Auth `additionalFields` with `input: false`, so they come back on the session with no extra query and clients can't set them through Better Auth's endpoints. One more piece of usage data per account.
3. **Booleans instead of timestamps**: the same, without the time. The time costs nothing more and helps tell accounts that saw the tour from those created before it existed.

## Decision

We will store two nullable timestamps on `User` (option 2): when the user first finished or skipped the app tour and the workspace tour. A server action sets each the first time only; replaying a tour leaves it. The columns are deleted with the account, like the rest of the row.

## Consequences

- A tour shows once per account, on any device. Existing accounts see each tour once, since there is no backfill.
- The privacy policy lists these timestamps under what we store.
- More onboarding state (e.g. per-feature hints) would follow the same pattern, and should stay as small: when something was seen, not what the user did.
