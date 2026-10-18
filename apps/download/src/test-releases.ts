import type { Release } from "./installers";

export const FILES = [
  "mac-arm64.dmg",
  "mac-x64.dmg",
  "win-x64.exe",
  "linux-x86_64.AppImage",
  "linux-amd64.deb",
];

export function desktopRelease(
  version: string,
  files = FILES,
  extra: Partial<Release> = {},
): Release {
  return {
    tag_name: `@furrow/desktop@${version}`,
    draft: false,
    prerelease: false,
    assets: files.map((file) => ({
      name: `furrow-cam-${version}-${file}`,
      browser_download_url: `https://example.com/${version}/${file}`,
    })),
    ...extra,
  };
}
