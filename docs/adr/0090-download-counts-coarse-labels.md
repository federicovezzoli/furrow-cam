# ADR-0090: Download counts record coarse client and location labels

- **Status:** Accepted
- **Date:** 2026-11-20
- **Deciders:** Federico Vezzoli
- **Related:** ADR-0013, ADR-0049; #638
- **Supersedes in part:** ADR-0049 (the "Counts" bullet)

## Context

ADR-0049 counts each `GET` of a platform on `download.furrow.cam` with only the platform and the version. The counts can't tell a person in a browser from `curl`, a CI job or a crawler following the links on furrow.cam, so they may be inflated, and they say nothing about where downloads come from or whether people download for a different machine than the one they browse on.

The request carries a `User-Agent` header, the visitor's IP address, and Cloudflare's `request.cf` with the country, region, city, postal code and coordinates worked out from the IP address. The raw user agent is close to unique per visitor, and an IP address is personal data under the GDPR (ADR-0013). A hash of the IP address doesn't help: IPv4 hashes can be reversed by trying every address.

## Options considered

1. **Keep platform and version only.** No privacy cost, but the counts stay unreliable.
2. **Store the raw user agent and the IP address, or a hash of it.** Most detail, but personal data, against ADR-0013.
3. **Store a few coarse labels worked out in the Worker.** Enough to separate people from bots and scripts, and to see systems and countries, without anything that identifies a visitor.
4. **Count unique downloaders** with a hash of the IP address and a daily salt. Repeat installer downloads are rare, and the salt needs storage and rotation.

## Decision

We will use option 3. Each counted download writes one data point to `furrow_downloads` with exactly these blobs:

| Blob | Contents | Values |
| --- | --- | --- |
| `blob1` | platform asked for | as ADR-0049 |
| `blob2` | installer version | as ADR-0049 |
| `blob3` | client kind | `browser`, `bot` (crawlers, link previewers), `cli` (`curl`, `wget`, scripts), `other`, or `none` (no `User-Agent` header) |
| `blob4` | OS family | `macos`, `windows`, `linux`, `other` (also phones and tablets, and no header) |
| `blob5` | browser family | `chrome`, `safari`, `firefox`, `edge`, `other` (also no header) |
| `blob6` | `request.cf.country` (ISO 3166-1 alpha-2) | or `none` |
| `blob7` | `request.cf.regionCode` (ISO 3166-2 subdivision) | or `none` |

- The labels come from a small matcher in `apps/download/src/user-agent.ts`, not a user-agent parsing dependency.
- **Not stored:** the IP address or any hash of it, the raw user agent, the referrer, and the city, postal code, coordinates and metro code from `request.cf`, which in a small town could come close to identifying one person. Nothing is logged; Workers Logs stay off.
- The rest of ADR-0049's "Counts" bullet stands: `HEAD` requests and fallbacks to the release list are not counted, and data is kept for three months.

Downloads per platform, version, client and country over the last 30 days:

```sql
SELECT blob1 AS platform, blob2 AS version, blob3 AS client, blob4 AS os,
       blob5 AS browser, blob6 AS country, blob7 AS region,
       SUM(_sample_interval) AS downloads
FROM furrow_downloads
WHERE timestamp > NOW() - INTERVAL '30' DAY
GROUP BY platform, version, client, os, browser, country, region
ORDER BY downloads DESC
```

## Consequences

- People can be counted apart from bots and scripts (`WHERE blob3 = 'browser'`), and comparing `blob4` with `blob1` shows downloads for a different machine.
- Data points written before this change have empty `blob3` to `blob7`; queries spanning the change must allow for empty values.
- Regions from the IP address are rough (VPNs, mobile networks), so they are an estimate.
- Unknown or new clients fall into `other` until the matcher learns them.
- The privacy policy says downloads are counted by system, version, client kind, country and region, and that the IP address is not kept.
