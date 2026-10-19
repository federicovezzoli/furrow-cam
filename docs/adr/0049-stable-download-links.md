# ADR-0049: Stable download links from a Cloudflare Worker, counted in Analytics Engine

- **Status:** Proposed
- **Date:** 2026-10-18
- **Deciders:** Federico Vezzoli
- **Related:** ADR-0012, ADR-0013, ADR-0044, ADR-0048; #201

## Context

The desktop installers are attached to each `@furrow/desktop@<version>` GitHub Release (ADR-0044). The repository has one release per package (ADR-0012), so GitHub's `releases/latest` usually points at `@furrow/web`, and there is no stable link to the newest installer. The README links a filtered release list, and the website hardcodes the version, which has to be bumped by hand after every release.

GitHub counts downloads per file, but only per release: there is no view per platform or over versions.

## Options considered

1. **Stable file names on a "latest" release.** Mark desktop releases as GitHub's latest. Then every web release would have to be created as not-latest, which Changesets doesn't support, and there would still be no counts beyond GitHub's.
2. **Copy the installers to Cloudflare R2** behind a stable path. Adds upload credentials, an upload step and cleanup to the release, without faster downloads, and R2 has no per-file download counter.
3. **A redirecting Worker.** A Cloudflare Worker on `download.furrow.cam` finds the newest desktop release through the GitHub API and redirects to the file. The files stay on GitHub, and the release workflow doesn't change.

For the counts: **GoatCounter** (ADR-0020) keeps data indefinitely, but takes server-side events only with an API token, and ADR-0020 excludes custom events. **Workers Analytics Engine** keeps the data inside Cloudflare, which already handles the request, and is queried with SQL; it keeps three months of data.

## Decision

We will use option 3, with the counts in Workers Analytics Engine. The Worker lives in `apps/download`.

- **Paths.** `/mac-arm64`, `/mac-x64`, `/win`, `/linux-appimage`, `/linux-deb` and `/linux-pacman` redirect (302, never cached) to `furrow-cam-<version>-<platform file>` on the newest non-draft, non-prerelease `@furrow/desktop@x.y.z` release that already has that file. Changesets creates the release a few minutes before the installers are attached, so in the meantime each platform keeps pointing at the previous version instead of failing. `/` redirects to the filtered release list; other paths are a 404.
- **GitHub.** The Worker reads the releases API, up to five pages of 100, stopping once every platform has a file. It keeps the answer in the data centre's cache for five minutes. Requests carry a fine-grained token with no permissions (Worker secret `GITHUB_TOKEN`), so they count against our rate limit rather than the one shared by Cloudflare's addresses. If GitHub can't be reached, the Worker redirects to the release list.
- **Counts.** Each `GET` of a platform writes one data point to the `furrow_downloads` dataset: the platform and the version, nothing else. No IP address, user agent, referrer, country or other request data is written. `HEAD` requests and fallbacks to the release list are not counted. Workers Logs are turned off, since they would store request details.
- **Deployment.** `.github/workflows/download.yml` deploys the Worker with Wrangler when `apps/download` changes on `main`, using the `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repository secrets. `download.furrow.cam` is the Worker's custom domain; `furrow.cam` already uses Cloudflare DNS.

Downloads per platform and version, e.g. over the last 30 days:

```sql
SELECT blob1 AS platform, blob2 AS version, SUM(_sample_interval) AS downloads
FROM furrow_downloads
WHERE timestamp > NOW() - INTERVAL '30' DAY
GROUP BY platform, version
ORDER BY downloads DESC
```

## Consequences

- The README, the website and anything else can link `download.furrow.cam/<platform>` once and never be bumped again.
- Cloudflare becomes a party that sees download requests, with the visitor's IP address, as it does for any site behind it; we store nothing personal (ADR-0013). The privacy policy must mention it.
- Counts cover three months; GitHub's `download_count` per file still has all-time totals. Downloads straight from the GitHub release page are not counted by the Worker.
- A new release reaches the links within five minutes of its installers being attached.
- Releases of other packages push desktop releases down the list; past 500 releases since the last desktop one, the Worker falls back to the release list.
- The desktop update check (ADR-0048) could ask the Worker instead of GitHub; that would need its own decision.
