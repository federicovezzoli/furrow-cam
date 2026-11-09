/**
 * Finding a newer desktop release on GitHub (ADR-0048), and the requests that
 * install it on Windows and Linux (ADR-0074). Pure helpers: the requests and
 * the dialogs are in `index.ts`.
 */

const REPO = "https://github.com/federicovezzoli/furrow-cam";

/** The one URL the macOS update check requests: every release of the repository. */
export const RELEASES_URL =
  "https://api.github.com/repos/federicovezzoli/furrow-cam/releases?per_page=100";

/**
 * What electron-updater may request: the update endpoint (`publish` in
 * `electron-builder.yml`), the desktop release files it redirects to, and
 * GitHub's storage, where those redirect in turn.
 */
const UPDATE_PREFIXES = [
  "https://download.furrow.cam/update/",
  `${REPO}/releases/download/%40furrow/desktop%40`,
  "https://release-assets.githubusercontent.com/",
  "https://objects.githubusercontent.com/",
];

export const isUpdateRequest = (url: string) =>
  UPDATE_PREFIXES.some((prefix) => url.startsWith(prefix));

/** The website's download section: each installer, through the counted links (ADR-0049). */
export const DOWNLOADS_PAGE = "https://furrow.cam/#download";

/** Desktop releases are tagged per package by Changesets (ADR-0012). */
const TAG_PREFIX = "@furrow/desktop@";

/** What the user chose about update checks, kept in `updates.json`. */
export type UpdatePrefs = {
  /** `undefined` until the user has been asked. */
  checkAtStartup?: boolean;
  /** A version the user chose to skip: start-up checks don't offer it again. */
  skippedVersion?: string;
};

/** A desktop release newer than the running app. */
export type Release = { version: string };

type Version = [number, number, number];

/** `1.2.3` as numbers; `null` for anything else, including prereleases. */
export function parseVersion(text: string): Version | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(text);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

function compare(a: Version, b: Version) {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/** The newest published, non-prerelease desktop release in the GitHub API's list. */
export function latestDesktopRelease(releases: unknown): Release | null {
  if (!Array.isArray(releases)) return null;
  let latest: { version: Version; release: Release } | null = null;
  for (const item of releases) {
    if (typeof item !== "object" || item === null) continue;
    const { tag_name: tag, draft, prerelease } = item as Record<string, unknown>;
    if (draft !== false || prerelease !== false) continue;
    if (typeof tag !== "string" || !tag.startsWith(TAG_PREFIX)) continue;
    const version = parseVersion(tag.slice(TAG_PREFIX.length));
    if (version && (!latest || compare(version, latest.version) > 0)) {
      latest = { version, release: { version: tag.slice(TAG_PREFIX.length) } };
    }
  }
  return latest?.release ?? null;
}

/** `release` if it's newer than the running `current` version, otherwise `null`. */
export function newerRelease(current: string, release: Release | null): Release | null {
  const running = parseVersion(current);
  const offered = release && parseVersion(release.version);
  if (!running || !offered) return null;
  return compare(offered, running) > 0 ? release : null;
}

export function parseUpdatePrefs(data: unknown): UpdatePrefs {
  if (typeof data !== "object" || data === null) return {};
  const { checkAtStartup, skippedVersion } = data as Record<string, unknown>;
  return {
    ...(typeof checkAtStartup === "boolean" ? { checkAtStartup } : {}),
    ...(typeof skippedVersion === "string" ? { skippedVersion } : {}),
  };
}
