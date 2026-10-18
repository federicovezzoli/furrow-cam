import { describe, expect, it } from "vitest";
import { latestDesktopRelease, newerRelease, parseUpdatePrefs, parseVersion } from "./updates";

const release = (tag: string, extra: Record<string, unknown> = {}) => ({
  tag_name: tag,
  html_url: `https://github.com/federicovezzoli/furrow-cam/releases/tag/${encodeURIComponent(tag)}`,
  draft: false,
  prerelease: false,
  ...extra,
});

describe("parseVersion", () => {
  it("reads major.minor.patch", () => {
    expect(parseVersion("1.12.3")).toEqual([1, 12, 3]);
  });

  it("refuses prereleases and other text", () => {
    expect(parseVersion("1.2.3-beta.1")).toBeNull();
    expect(parseVersion("v1.2.3")).toBeNull();
    expect(parseVersion("1.2")).toBeNull();
  });
});

describe("latestDesktopRelease", () => {
  it("picks the highest desktop version, ignoring other packages", () => {
    const releases = [
      release("@furrow/web@3.0.0"),
      release("@furrow/desktop@0.9.0"),
      release("@furrow/desktop@0.10.0"),
      release("@furrow/cam-core@5.0.0"),
    ];
    expect(latestDesktopRelease(releases)).toEqual({
      version: "0.10.0",
      url: releases[2]?.html_url,
    });
  });

  it("ignores drafts, prereleases and prerelease versions", () => {
    const releases = [
      release("@furrow/desktop@0.3.0", { draft: true }),
      release("@furrow/desktop@0.4.0", { prerelease: true }),
      release("@furrow/desktop@0.5.0-beta.0"),
      release("@furrow/desktop@0.2.0"),
    ];
    expect(latestDesktopRelease(releases)?.version).toBe("0.2.0");
  });

  it("ignores pages outside GitHub", () => {
    const releases = [release("@furrow/desktop@0.2.0", { html_url: "https://example.com/" })];
    expect(latestDesktopRelease(releases)).toBeNull();
  });

  it("returns null for an unexpected response", () => {
    expect(latestDesktopRelease({ message: "API rate limit exceeded" })).toBeNull();
    expect(latestDesktopRelease([null, 3, "x"])).toBeNull();
  });
});

describe("newerRelease", () => {
  const offered = { version: "0.2.0", url: "https://github.com/" };

  it("offers a higher version", () => {
    expect(newerRelease("0.1.9", offered)).toBe(offered);
    expect(newerRelease("0.1.0", { ...offered, version: "1.0.0" })).not.toBeNull();
  });

  it("offers nothing for the same or an older version", () => {
    expect(newerRelease("0.2.0", offered)).toBeNull();
    expect(newerRelease("0.10.0", offered)).toBeNull();
    expect(newerRelease("0.1.0", null)).toBeNull();
  });
});

describe("parseUpdatePrefs", () => {
  it("keeps only known, well-typed fields", () => {
    expect(parseUpdatePrefs({ checkAtStartup: true, skippedVersion: "0.2.0", x: 1 })).toEqual({
      checkAtStartup: true,
      skippedVersion: "0.2.0",
    });
    expect(parseUpdatePrefs({ checkAtStartup: "yes" })).toEqual({});
    expect(parseUpdatePrefs(null)).toEqual({});
  });
});
