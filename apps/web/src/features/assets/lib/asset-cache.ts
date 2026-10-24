import { sha256Hex } from "@furrow/workspace/lib/mesh-worker-protocol";
import { downloadAsset } from "./assets";

/**
 * Asset files, STL meshes and uploaded fonts, kept in the browser's Cache
 * Storage by hash, so each is downloaded once rather than each time its
 * project opens (ADR-0029, ADR-0062). A hash names one file, so both kinds
 * share the cache. The
 * cache is best effort: it is missing on insecure origins and the browser
 * may clear it, so failures are ignored and the file is downloaded again.
 * A cached copy that doesn't match its hash is downloaded again too; whoever
 * reads a file still checks it, which catches a download that doesn't match.
 */

// Named before fonts were assets; kept, so meshes cached before aren't downloaded again.
const CACHE_NAME = "furrow-meshes";

/** Cache Storage keys are requests; these never reach the network. */
function cacheKey(sha256: string) {
  return new URL(`/__meshes/${sha256}`, location.origin).href;
}

export async function readCachedAsset(sha256: string): Promise<ArrayBuffer | null> {
  try {
    const cache = await caches.open(CACHE_NAME);
    const response = await cache.match(cacheKey(sha256));
    return response ? await response.arrayBuffer() : null;
  } catch {
    return null;
  }
}

export async function cacheAsset(sha256: string, file: Blob) {
  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(cacheKey(sha256), new Response(file));
  } catch {
    // Downloaded again next time.
  }
}

export async function evictCachedAsset(sha256: string) {
  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.delete(cacheKey(sha256));
  } catch {
    // Replaced when the file is cached again.
  }
}

/** An asset's file from the browser's cache, or else downloaded and cached (ADR-0029). */
export async function loadAsset(projectId: string, sha256: string): Promise<ArrayBuffer> {
  const cached = await readCachedAsset(sha256);
  if (cached) {
    // A partial write or a storage bug would otherwise fail on every load.
    if ((await sha256Hex(cached)) === sha256) return cached;
    await evictCachedAsset(sha256);
  }
  const bytes = await downloadAsset(projectId, sha256);
  await cacheAsset(sha256, new Blob([bytes]));
  return bytes;
}
