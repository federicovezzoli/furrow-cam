# ADR-0023: Password length limits and breached-password check

- **Status:** Proposed
- **Date:** 2026-10-14
- **Deciders:** Federico Vezzoli
- **Related:** PRD-0001 (R17), ADR-0006, ADR-0013

## Context

Sign-up and password reset (ADR-0006) only checked length, through Better Auth's implicit defaults (8 to 128 characters), so passwords such as `password` or `12345678` were accepted on a public instance. NIST SP 800-63B recommends a minimum length plus a blocklist of known-compromised passwords, and no composition rules (required digits, symbols and so on).

The obvious blocklist is the Have I Been Pwned (HIBP) Pwned Passwords corpus. Querying it adds a third party, which ADR-0013 asks us to record.

## Options considered

1. **Length only**: no third party, but common and breached passwords still pass.
2. **Composition rules**: discouraged by NIST; they push users to predictable patterns and do not stop breached passwords.
3. **Bundled blocklist** (e.g. the top 100k breached passwords): no third party, but it adds a large file to the server bundle and covers only the most common passwords.
4. **HIBP range API, Better Auth's `haveIBeenPwned()` plugin**: the full corpus with no new dependency. It fails closed (sign-up and reset return a 500 when the API is unreachable), and its request has no timeout, so a hanging API hangs sign-up.
5. **HIBP range API, our own check**: the same request as the plugin, with a timeout and a choice of outage behaviour.

## Decision

- **Length:** new passwords must be 8 to 128 characters. The limits are set explicitly in the Better Auth config (`minPasswordLength`, `maxPasswordLength`) from one constant; the sign-up and reset forms use the same minimum as `minLength`. The forms set no `maxLength`: browsers silently truncate longer pasted or autofilled values, so a password manager would save a password the account does not have. Longer passwords get Better Auth's error instead. No composition rules.
- **Breached passwords:** when a password is set (`/sign-up/email`, `/reset-password`, `/change-password`) and its length is valid, a Better Auth `before` hook checks it against HIBP with the k-anonymity range API: the server hashes the password with SHA-1 and sends only the **first 5 hex characters** of the hash to `api.pwnedpasswords.com/range/`, with `Add-Padding` so the response size does not reveal the match. The match is done on our server. A listed password is rejected with "This password has appeared in a data breach. Please choose a different one." The check runs in a `before` hook rather than when Better Auth hashes the password (as its `haveIBeenPwned()` plugin does) because `/reset-password` consumes the reset token before hashing: a rejection there would burn the reset link. A `before` hook runs before the token or session is validated, so `/reset-password` gets the same strict rate limit as sign-in (3 requests per 10 seconds); sign-up and change-password already have it.
- **Outage behaviour: fail open.** The request times out after 3 seconds. On a timeout, network error or non-200 response, the server logs a warning and accepts the password; the length limits still apply. We prefer that sign-up and reset keep working over enforcing the blocklist during an HIBP outage. There is no circuit breaker: during an outage each request waits for the timeout. Serverless instances are short-lived, so in-memory breaker state would help little, and setting a password is rare.

What HIBP receives: a 5-character hash prefix, shared by hundreds of unrelated passwords, and the request's metadata. The request is server-to-server, so it carries our server's IP address, never the user's. No email address or other personal data is sent.

## Consequences

- Known-breached passwords cannot be chosen, except during an HIBP outage.
- Existing passwords are not re-checked; the check applies only when a password is set.
- Sign-up, reset and password change make one outbound request to HIBP, adding latency (up to the 3-second timeout, on every such request while HIBP is down).
- HIBP is a new third party for these requests; the privacy policy mentions the check and what is sent.
