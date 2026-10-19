import { describe, expect, it } from "vitest";
import { desktopDownload } from "./desktop-download";

const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/141.0";
const WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/141.0";
const LINUX = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/141.0";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15";

describe("desktopDownload", () => {
  it("picks the installer for the visitor's system", () => {
    expect(desktopDownload(MAC)).toEqual({
      system: "macOS",
      url: "https://download.furrow.cam/mac-arm64",
    });
    expect(desktopDownload(WINDOWS)?.url).toBe("https://download.furrow.cam/win");
    expect(desktopDownload(LINUX)?.url).toBe("https://download.furrow.cam/linux-appimage");
    expect(desktopDownload(WINDOWS, "Windows")?.system).toBe("Windows");
  });

  it("offers none on phones and tablets, including iPads that report a Mac", () => {
    expect(desktopDownload(IPHONE)).toBeNull();
    expect(desktopDownload(MAC, "MacIntel", 5)).toBeNull();
  });
});
