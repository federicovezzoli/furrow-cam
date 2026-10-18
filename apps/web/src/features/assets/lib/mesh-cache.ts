import { sha256Hex } from "@/features/workspace/lib/mesh-worker-protocol";
import { downloadMesh } from "./meshes";

/**
 * STL files kept in the browser's Cache Storage by hash, so a model is
 * downloaded once rather than each time its project opens (ADR-0029). The
 * cache is best effort: it is missing on insecure origins and the browser
 * may clear it, so failures are ignored and the file is downloaded again.
 * A cached copy that doesn't match its hash is downloaded again too; whoever
 * reads a file still checks it, which catches a download that doesn't match.
 */

const CACHE_NAME = "furrow-meshes";

/** Cache Storage keys are requests; these never reach the network. */
function cacheKey(sha256: string) {
  return new URL(`/__meshes/${sha256}`, location.origin).href;
}

export async function readCachedMesh(sha256: string): Promise<ArrayBuffer | null> {
  try {
    const cache = await caches.open(CACHE_NAME);
    const response = await cache.match(cacheKey(sha256));
    return response ? await response.arrayBuffer() : null;
  } catch {
    return null;
  }
}

export async function cacheMesh(sha256: string, file: Blob) {
  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(cacheKey(sha256), new Response(file));
  } catch {
    // Downloaded again next time.
  }
}

export async function evictCachedMesh(sha256: string) {
  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.delete(cacheKey(sha256));
  } catch {
    // Replaced when the file is cached again.
  }
}

/** A mesh's file from the browser's cache, or else downloaded and cached (ADR-0029). */
export async function loadMesh(projectId: string, sha256: string): Promise<ArrayBuffer> {
  const cached = await readCachedMesh(sha256);
  if (cached) {
    // A partial write or a storage bug would otherwise fail on every load.
    if ((await sha256Hex(cached)) === sha256) return cached;
    await evictCachedMesh(sha256);
  }
  const bytes = await downloadMesh(projectId, sha256);
  await cacheMesh(sha256, new Blob([bytes]));
  return bytes;
}
