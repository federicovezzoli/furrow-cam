---
"@furrow/web": minor
---

Sign-up and password reset reject passwords found in the Have I Been Pwned breach corpus (only a 5-character hash prefix is sent; if the service is unreachable the password is accepted), and the 8–128 character length limits are set explicitly, with the minimum shared with the forms. Password reset is rate-limited like sign-in.
