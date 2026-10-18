import { describe, expect, it, vi } from "vitest";
import { createWorker, DESKTOP_RELEASES_URL, type Deps } from "./index";
import { desktopRelease } from "./test-releases";

function setup(pages: unknown[][] | Error, { cacheFails = false } = {}) {
  const store = new Map<string, Response>();
  const cache = {
    match: async (key: string) => {
      if (cacheFails) throw new Error("cache down");
      return store.get(key)?.clone();
    },
    put: async (key: string, response: Response) => {
      if (cacheFails) throw new Error("cache down");
      store.set(key, response);
    },
  } as unknown as Cache;
  const fetch = vi.fn<Deps["fetch"]>(async (url) => {
    if (pages instanceof Error) throw pages;
    const page = Number(new URL(url).searchParams.get("page"));
    return Response.json(pages[page - 1] ?? []);
  });
  const writeDataPoint = vi.fn();
  const env = { DOWNLOADS: { writeDataPoint } as AnalyticsEngineDataset };
  const worker = createWorker({ fetch, cache: () => cache });
  const get = (path: string, method = "GET") =>
    worker.fetch(new Request(`https://download.furrow.cam${path}`, { method }), env);
  return { fetch, writeDataPoint, get };
}

describe("download worker", () => {
  it("redirects a platform to its newest installer and counts it", async () => {
    const { get, writeDataPoint } = setup([[desktopRelease("0.3.0"), desktopRelease("0.2.1")]]);
    const response = await get("/mac-arm64");
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("https://example.com/0.3.0/mac-arm64.dmg");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(writeDataPoint).toHaveBeenCalledWith({
      indexes: ["mac-arm64"],
      blobs: ["mac-arm64", "0.3.0"],
    });
  });

  it("asks GitHub once while the cached answer is fresh", async () => {
    const { get, fetch } = setup([[desktopRelease("0.3.0")]]);
    await get("/win");
    await get("/linux-deb");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("shares one GitHub load between requests that arrive together", async () => {
    const { get, fetch } = setup([[desktopRelease("0.3.0")]]);
    const responses = await Promise.all([get("/win"), get("/mac-x64"), get("/linux-deb")]);
    expect(responses.map((response) => response.status)).toEqual([302, 302, 302]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("still redirects to the installer when the cache fails", async () => {
    const { get } = setup([[desktopRelease("0.3.0")]], { cacheFails: true });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await get("/win");
    expect(response.headers.get("Location")).toBe("https://example.com/0.3.0/win-x64.exe");
  });

  it("reads further pages until every platform has a file", async () => {
    const others = Array.from({ length: 100 }, (_, i) => ({
      tag_name: `@furrow/web@0.${i}.0`,
      draft: false,
      prerelease: false,
      assets: [],
    }));
    const { get, fetch } = setup([others, [desktopRelease("0.3.0")]]);
    const response = await get("/linux-appimage");
    expect(response.headers.get("Location")).toBe(
      "https://example.com/0.3.0/linux-x86_64.AppImage",
    );
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("does not count HEAD requests", async () => {
    const { get, writeDataPoint } = setup([[desktopRelease("0.3.0")]]);
    expect((await get("/win", "HEAD")).status).toBe(302);
    expect(writeDataPoint).not.toHaveBeenCalled();
  });

  it("falls back to the release list when GitHub fails, without counting", async () => {
    const { get, writeDataPoint } = setup(new Error("offline"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await get("/win");
    expect(response.headers.get("Location")).toBe(DESKTOP_RELEASES_URL);
    expect(writeDataPoint).not.toHaveBeenCalled();
  });

  it("sends / to the release list and rejects unknown paths and methods", async () => {
    const { get, fetch } = setup([]);
    expect((await get("/")).headers.get("Location")).toBe(DESKTOP_RELEASES_URL);
    expect((await get("/mac")).status).toBe(404);
    expect((await get("/win", "POST")).status).toBe(405);
    expect(fetch).not.toHaveBeenCalled();
  });
});
