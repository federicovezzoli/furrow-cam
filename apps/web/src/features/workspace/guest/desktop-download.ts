/** The website's download section, listing every installer. */
export const DESKTOP_DOWNLOADS_PAGE = "https://furrow.cam/#download";

/** Stable links to the newest installer for each system (ADR-0049). */
const DOWNLOADS = {
  macArm64: "https://download.furrow.cam/mac-arm64",
  winX64: "https://download.furrow.cam/win",
  linuxAppImage: "https://download.furrow.cam/linux-appimage",
};

/**
 * The desktop installer for the visitor's system, named for the button, or
 * `null` where there is none (phones, tablets, unknown systems) and the
 * download page is offered instead. Macs get the Apple Silicon build: the
 * browser rarely tells the architecture, and the page lists the Intel one.
 */
export function desktopDownload(
  userAgent: string,
  platform = userAgent,
  maxTouchPoints = 0,
): { system: string; url: string } | null {
  // iPadOS reports itself as a Mac; touch support gives it away.
  if (/Android|iPhone|iPad/.test(userAgent) || (/Mac/.test(userAgent) && maxTouchPoints > 1)) {
    return null;
  }
  if (/win/i.test(platform)) return { system: "Windows", url: DOWNLOADS.winX64 };
  if (/mac/i.test(platform)) return { system: "macOS", url: DOWNLOADS.macArm64 };
  if (/linux/i.test(platform)) return { system: "Linux", url: DOWNLOADS.linuxAppImage };
  return null;
}
