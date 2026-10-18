// download.furrow.cam: redirects /<platform> to the newest desktop installer on GitHub
// Releases and counts the download (ADR-0049).

import {
  findInstallers,
  hasEveryPlatform,
  type Installers,
  isPlatform,
  PLATFORMS,
  type Release,
} from "./installers";

const REPO = "federicovezzoli/furrow-cam";
export const DESKTOP_RELEASES_URL = `https://github.com/${REPO}/releases?q=%40furrow%2Fdesktop&expanded=true`;

// The newest installers, kept in the data centre's cache so GitHub is asked at most
// once every few minutes per location.
const CACHE_KEY = "https://download.furrow.cam/__installers";
const CACHE_SECONDS = 300;
// The repository has one release per package, so a desktop release can sit behind many
// others; stop once every platform has a file.
const PER_PAGE = 100;
const MAX_PAGES = 5;

export interface Env {
  DOWNLOADS?: AnalyticsEngineDataset;
  GITHUB_TOKEN?: string;
}

export interface Deps {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  cache: () => Cache | undefined;
}

async function fetchReleases(deps: Deps, token: string | undefined): Promise<Release[]> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "furrow-download",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const releases: Release[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const response = await deps.fetch(
      `https://api.github.com/repos/${REPO}/releases?per_page=${PER_PAGE}&page=${page}`,
      { headers },
    );
    if (!response.ok) throw new Error(`GitHub releases: HTTP ${response.status}`);
    const batch = (await response.json()) as Release[];
    releases.push(...batch);
    if (batch.length < PER_PAGE || hasEveryPlatform(findInstallers(releases))) break;
  }
  return releases;
}

async function loadInstallers(deps: Deps, env: Env): Promise<Installers> {
  const cache = deps.cache();
  // The cache only saves GitHub requests: if it fails, ask GitHub instead of failing the download.
  const cached = await cache?.match(CACHE_KEY).catch(() => undefined);
  if (cached) return cached.json();

  const installers = findInstallers(await fetchReleases(deps, env.GITHUB_TOKEN));
  await cache
    ?.put(
      CACHE_KEY,
      Response.json(installers, { headers: { "Cache-Control": `max-age=${CACHE_SECONDS}` } }),
    )
    .catch((error: unknown) => console.error(error));
  return installers;
}

// Never cached, so every download reaches the Worker and is counted.
const redirect = (url: string) =>
  new Response(null, { status: 302, headers: { Location: url, "Cache-Control": "no-store" } });

const NOT_FOUND = `Unknown download. Try one of: ${Object.keys(PLATFORMS)
  .map((platform) => `/${platform}`)
  .join(", ")}\n`;

export function createWorker(deps: Deps) {
  // Requests that arrive together, e.g. after the cached answer expires, share one load.
  let pending: Promise<Installers> | undefined;
  const sharedLoad = (env: Env) => {
    pending ??= loadInstallers(deps, env).finally(() => {
      pending = undefined;
    });
    return pending;
  };

  return {
    async fetch(request: Request, env: Env): Promise<Response> {
      if (request.method !== "GET" && request.method !== "HEAD") {
        return new Response("Method not allowed\n", {
          status: 405,
          headers: { Allow: "GET, HEAD" },
        });
      }

      const path = new URL(request.url).pathname.replace(/^\/+|\/+$/g, "");
      if (path === "") return redirect(DESKTOP_RELEASES_URL);
      if (!isPlatform(path)) return new Response(NOT_FOUND, { status: 404 });

      let installers: Installers = {};
      try {
        installers = await sharedLoad(env);
      } catch (error) {
        console.error(error);
      }
      const installer = installers[path];
      // GitHub unreachable, or no release has this file yet: the release list still works.
      if (!installer) return redirect(DESKTOP_RELEASES_URL);

      // Platform and version only: no IP address, user agent or other request data.
      if (request.method === "GET") {
        env.DOWNLOADS?.writeDataPoint({ indexes: [path], blobs: [path, installer.version] });
      }
      return redirect(installer.url);
    },
  };
}

export default createWorker({
  fetch: (url, init) => fetch(url, init),
  cache: () => (typeof caches === "undefined" ? undefined : caches.default),
}) satisfies ExportedHandler<Env>;
