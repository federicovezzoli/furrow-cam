import { describe, expect, it } from "vitest";
import { findInstallers, hasEveryPlatform, isPlatform } from "./installers";
import { desktopRelease, FILES } from "./test-releases";

describe("findInstallers", () => {
  it("picks the highest desktop version, ignoring other packages", () => {
    const installers = findInstallers([
      { tag_name: "@furrow/web@0.10.2", draft: false, prerelease: false, assets: [] },
      desktopRelease("0.2.1"),
      desktopRelease("0.10.0"),
      desktopRelease("0.9.3"),
    ]);
    expect(installers.win).toEqual({
      version: "0.10.0",
      url: "https://example.com/0.10.0/win-x64.exe",
    });
    expect(hasEveryPlatform(installers)).toBe(true);
  });

  it("falls back per platform while a release's files are still being attached", () => {
    const installers = findInstallers([
      desktopRelease("0.4.0", ["mac-arm64.dmg"]),
      desktopRelease("0.3.0"),
    ]);
    expect(installers["mac-arm64"]?.version).toBe("0.4.0");
    expect(installers["linux-deb"]?.version).toBe("0.3.0");
  });

  it("skips drafts, prereleases and files named for another version", () => {
    const installers = findInstallers([
      desktopRelease("0.5.0", FILES, { draft: true }),
      desktopRelease("0.4.0", FILES, { prerelease: true }),
      { ...desktopRelease("0.3.1"), assets: desktopRelease("0.3.0").assets },
    ]);
    expect(installers).toEqual({});
    expect(hasEveryPlatform(installers)).toBe(false);
  });
});

describe("isPlatform", () => {
  it("accepts only the known paths", () => {
    expect(isPlatform("win")).toBe(true);
    expect(isPlatform("toString")).toBe(false);
    expect(isPlatform("win-x64.exe")).toBe(false);
  });
});
