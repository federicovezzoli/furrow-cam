// Which file each platform downloads, and how to find the newest one among the releases.

/** The path on download.furrow.cam → the end of the installer's file name. */
export const PLATFORMS = {
  "mac-arm64": "mac-arm64.dmg",
  "mac-x64": "mac-x64.dmg",
  win: "win-x64.exe",
  "linux-appimage": "linux-x86_64.AppImage",
  "linux-deb": "linux-amd64.deb",
} as const;

export type Platform = keyof typeof PLATFORMS;

export const isPlatform = (value: string): value is Platform => Object.hasOwn(PLATFORMS, value);

/** The fields we read from GitHub's releases API. */
export interface Release {
  tag_name: string;
  draft: boolean;
  prerelease: boolean;
  assets: { name: string; browser_download_url: string }[];
}

export interface Installer {
  version: string;
  url: string;
}

export type Installers = Partial<Record<Platform, Installer>>;

const TAG_PREFIX = "@furrow/desktop@";

const parseVersion = (tag: string): number[] | undefined => {
  if (!tag.startsWith(TAG_PREFIX)) return undefined;
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(tag.slice(TAG_PREFIX.length));
  return match ? match.slice(1).map(Number) : undefined;
};

const compareVersions = (a: number[], b: number[]) => {
  for (let i = 0; i < 3; i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
};

/**
 * For each platform, the highest desktop version whose release already has that
 * platform's file. Installers are attached a few minutes after Changesets creates the
 * release, so until then a platform keeps pointing at the previous version.
 */
export function findInstallers(releases: Release[]): Installers {
  const desktop = releases
    .filter((release) => !release.draft && !release.prerelease)
    .flatMap((release) => {
      const version = parseVersion(release.tag_name);
      return version ? [{ release, version }] : [];
    })
    .sort((a, b) => compareVersions(b.version, a.version));

  const installers: Installers = {};
  for (const platform of Object.keys(PLATFORMS) as Platform[]) {
    for (const { release, version } of desktop) {
      const name = `furrow-cam-${version.join(".")}-${PLATFORMS[platform]}`;
      const asset = release.assets.find((candidate) => candidate.name === name);
      if (asset) {
        installers[platform] = { version: version.join("."), url: asset.browser_download_url };
        break;
      }
    }
  }
  return installers;
}

export const hasEveryPlatform = (installers: Installers) =>
  Object.keys(PLATFORMS).every((platform) => platform in installers);
