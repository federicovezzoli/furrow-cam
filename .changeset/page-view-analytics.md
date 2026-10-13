---
"@furrow/web": minor
---

Count page views with GoatCounter when `NEXT_PUBLIC_GOATCOUNTER_URL` is set: no cookies, one count per navigation, and only the route pattern (e.g. `/projects/[id]`) is sent, never IDs or query strings.
