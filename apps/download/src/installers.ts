// Which file each platform downloads, and how to find the newest one among the releases.

export const REPO = "federicovezzoli/furrow-cam";

/** The path on download.furrow.cam → the end of the installer's file name. */
export const PLATFORMS = {
  "mac-arm64": "mac-arm64.dmg",
  "mac-x64": "mac-x64.dmg",
  win: "win-x64.exe",
  "linux-appimage": "linux-x86_64.AppImage",
  "linux-deb": "linux-amd64.deb",
  "linux-pacman": "linux-x64.pacman",
} as const;

export type Platform = keyof typeof PLATFORMS;

export const isPlatform = (value: string): value is Platform => Object.hasOwn(PLATFORMS, value);

/** The update metadata electron-updater reads (ADR-0074): the same name in every release. */
export const UPDATE_FILES = ["latest.yml", "latest-linux.yml"] as const;

export type UpdateFile = (typeof UPDATE_FILES)[number];

export const isUpdateFile = (value: string): value is UpdateFile =>
  (UPDATE_FILES as readonly string[]).includes(value);

/** Every file we look for: the installers by platform, and the update metadata. */
const FILES = [...(Object.keys(PLATFORMS) as Platform[]), ...UPDATE_FILES];

const assetName = (file: Platform | UpdateFile, version: string) =>
  isUpdateFile(file) ? file : `furrow-cam-${version}-${PLATFORMS[file]}`;

/** A file `assetName` names for its version: an installer, or its blockmap. */
const RELEASE_FILE = /^furrow-cam-(\d+\.\d+\.\d+)-[\w.-]+$/;

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

export type Installers = Partial<Record<Platform | UpdateFile, Installer>>;

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
 * For each platform and update file, the highest desktop version whose release already
 * has that file. Installers are attached a few minutes after Changesets creates the
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
  for (const file of FILES) {
    for (const { release, version } of desktop) {
      const name = assetName(file, version.join("."));
      const asset = release.assets.find((candidate) => candidate.name === name);
      if (asset) {
        installers[file] = { version: version.join("."), url: asset.browser_download_url };
        break;
      }
    }
  }
  return installers;
}

/**
 * Where GitHub serves `name` from the desktop release of the version in it, or `undefined`
 * for a name `assetName` wouldn't give.
 */
export function releaseFileUrl(name: string) {
  const version = RELEASE_FILE.exec(name)?.[1];
  if (!version) return undefined;
  const tag = TAG_PREFIX.replaceAll("@", "%40") + version;
  return `https://github.com/${REPO}/releases/download/${tag}/${name}`;
}

/** The update metadata comes with the installers, so finding those is enough. */
export const hasEveryPlatform = (installers: Installers) =>
  Object.keys(PLATFORMS).every((platform) => platform in installers);
