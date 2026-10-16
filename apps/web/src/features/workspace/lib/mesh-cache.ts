import { downloadMesh } from "@/features/assets/lib/meshes";

/**
 * STL files kept in the browser's Cache Storage by hash, so a model is
 * downloaded once rather than each time its project opens (ADR-0029). The
 * cache is best effort: it is missing on insecure origins and the browser
 * may clear it, so failures are ignored and the file is downloaded again.
 * Whoever reads a file checks it against its hash.
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

/** A mesh's file from the browser's cache, or else downloaded and cached (ADR-0029). */
export async function loadMesh(projectId: string, sha256: string): Promise<ArrayBuffer> {
  const cached = await readCachedMesh(sha256);
  if (cached) return cached;
  const bytes = await downloadMesh(projectId, sha256);
  await cacheMesh(sha256, new Blob([bytes]));
  return bytes;
}
