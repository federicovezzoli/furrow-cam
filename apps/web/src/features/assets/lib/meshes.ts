import {
  discardMesh,
  getMeshUrl,
  requestMeshUpload,
  verifyMeshUpload,
} from "@/features/assets/actions";

const UPLOAD_FAILED = "The model couldn't be uploaded. Check your connection and try again.";
const DOWNLOAD_FAILED = "The model couldn't be downloaded. Check your connection and reload.";

/**
 * Uploads `file`, hashing to `sha256`, to the project's assets and has the
 * server verify it (ADR-0029), so documents may reference it. Returns why it
 * failed, for the user, or whether this call uploaded it: `false` when the
 * project already had it.
 */
export async function uploadMesh(
  projectId: string,
  sha256: string,
  file: Blob,
): Promise<{ uploaded: boolean; error?: never } | { error: string }> {
  try {
    const request = await requestMeshUpload(projectId, sha256, file.size);
    if (request.error !== undefined) return { error: request.error };
    if (!request.upload) return { uploaded: false };
    const { url, headers } = request.upload;
    const response = await fetch(url, { method: "PUT", headers, body: file });
    // 412: an earlier upload of the same file got there first, which verifying settles.
    if (!response.ok && response.status !== 412) return { error: UPLOAD_FAILED };
    const verified = await verifyMeshUpload(projectId, sha256);
    if (verified?.error !== undefined) return { error: verified.error };
    return { uploaded: true };
  } catch (error) {
    console.error(error);
    return { error: UPLOAD_FAILED };
  }
}

/**
 * Deletes an uploaded mesh that the import then didn't use, unless a saved
 * document refers to it (ADR-0029). Failures are logged, not reported: the
 * import already failed for its own reason, and an unused asset only costs
 * storage.
 */
export async function discardUpload(projectId: string, sha256: string) {
  try {
    const result = await discardMesh(projectId, sha256);
    if (result?.error !== undefined) console.error(result.error);
  } catch (error) {
    console.error(error);
  }
}

/** Downloads the project's mesh `sha256`; throws an `Error` for the user if it can't. */
export async function downloadMesh(projectId: string, sha256: string): Promise<ArrayBuffer> {
  const link = await getMeshUrl(projectId, sha256).catch(() => ({ error: DOWNLOAD_FAILED }));
  if (link.error !== undefined) throw new Error(link.error);
  const response = await fetch(link.url).catch(() => null);
  if (!response?.ok) throw new Error(DOWNLOAD_FAILED);
  return response.arrayBuffer();
}
