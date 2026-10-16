"use server";

import { Sha256 } from "@furrow/document";
import { getUserId } from "@/features/auth/server";
import { lockProject, parseProjectId } from "@/features/projects/server";
import { db } from "@/lib/db";
import { type ActionResult, SIGNED_OUT } from "@/lib/form-data";
import {
  assetKey,
  checkObject,
  deleteObject,
  isStorageConfigured,
  MAX_MESH_BYTES,
  type PresignedUpload,
  presignDownload,
  presignUpload,
} from "./server";

const NOT_FOUND = "This project no longer exists.";
const NO_STORAGE = "STL import isn't available on this server.";
const ASSET_NOT_FOUND = "This mesh hasn't been uploaded.";
const MISMATCH = "The uploaded file doesn't match the one picked. Try again.";

/**
 * The asset and object key of mesh `sha256` in the user's project, or why
 * there is none: no storage, a malformed id or hash, or someone else's project.
 */
async function findProject(
  userId: string,
  projectId: unknown,
  sha256: unknown,
): Promise<{ projectId: string; sha256: string; key: string; error?: never } | { error: string }> {
  if (!isStorageConfigured()) return { error: NO_STORAGE };
  const id = parseProjectId(projectId);
  if (!id) return { error: NOT_FOUND };
  const hash = Sha256.safeParse(sha256);
  if (!hash.success) return { error: "Invalid file hash." };
  const project = await db.project.findFirst({ where: { id, userId }, select: { id: true } });
  if (!project) return { error: NOT_FOUND };
  return { projectId: id, sha256: hash.data, key: assetKey(userId, id, hash.data) };
}

async function markVerified(projectId: string, sha256: string) {
  await db.projectAsset.update({
    where: { projectId_sha256: { projectId, sha256 } },
    data: { verifiedAt: new Date() },
  });
}

/**
 * Starts uploading a mesh of `size` bytes hashing to `sha256` (lowercase
 * hex) to the user's project (ADR-0029). Returns where the browser uploads
 * it; call `verifyMeshUpload` afterwards. `uploaded` comes back instead when
 * the project already has it, and nothing needs uploading.
 */
export async function requestMeshUpload(
  projectId: string,
  sha256: string,
  size: number,
): Promise<
  | { upload: PresignedUpload; uploaded?: never; error?: never }
  | { uploaded: true; upload?: never; error?: never }
  | { error: string }
> {
  const userId = await getUserId();
  if (!userId) return { error: SIGNED_OUT };
  const project = await findProject(userId, projectId, sha256);
  if (project.error !== undefined) return { error: project.error };
  if (!Number.isSafeInteger(size) || size <= 0) return { error: "This file is empty." };
  if (size > MAX_MESH_BYTES) {
    return {
      error: `This file is larger than ${MAX_MESH_BYTES / 1_000_000} MB, the most allowed.`,
    };
  }

  const where = { projectId_sha256: { projectId: project.projectId, sha256: project.sha256 } };
  const asset = await db.projectAsset.upsert({
    where,
    create: { projectId: project.projectId, sha256: project.sha256, size },
    update: {},
    select: { size: true, verifiedAt: true },
  });
  if (asset.verifiedAt) return { uploaded: true };
  if (asset.size !== size) await db.projectAsset.update({ where, data: { size } });

  // An earlier attempt may have uploaded it without verifying it.
  const stored = await checkObject(project.key, size, project.sha256);
  if (stored === "ok") {
    await markVerified(project.projectId, project.sha256);
    return { uploaded: true };
  }
  // Only storage that ignores the signed checksum could hold other bytes; replace them.
  if (stored === "mismatch") await deleteObject(project.key);
  return { upload: await presignUpload(project.key, size, project.sha256) };
}

/**
 * Checks that the mesh `sha256` the browser uploaded is stored, with the size
 * and hash requested, so documents may reference it (ADR-0029).
 */
export async function verifyMeshUpload(projectId: string, sha256: string): Promise<ActionResult> {
  const userId = await getUserId();
  if (!userId) return { error: SIGNED_OUT };
  const project = await findProject(userId, projectId, sha256);
  if (project.error !== undefined) return { error: project.error };
  const asset = await db.projectAsset.findUnique({
    where: { projectId_sha256: { projectId: project.projectId, sha256: project.sha256 } },
    select: { size: true, verifiedAt: true },
  });
  if (!asset) return { error: ASSET_NOT_FOUND };
  if (asset.verifiedAt) return;

  const stored = await checkObject(project.key, asset.size, project.sha256);
  if (stored === "missing") return { error: ASSET_NOT_FOUND };
  if (stored === "mismatch") {
    await deleteObject(project.key);
    return { error: MISMATCH };
  }
  await markVerified(project.projectId, project.sha256);
}

/** A short-lived URL to download the mesh `sha256` of the user's project. */
export async function getMeshUrl(
  projectId: string,
  sha256: string,
): Promise<{ url: string; error?: never } | { error: string }> {
  const userId = await getUserId();
  if (!userId) return { error: SIGNED_OUT };
  const project = await findProject(userId, projectId, sha256);
  if (project.error !== undefined) return { error: project.error };
  const asset = await db.projectAsset.findFirst({
    where: { projectId: project.projectId, sha256: project.sha256, verifiedAt: { not: null } },
    select: { id: true },
  });
  if (!asset) return { error: ASSET_NOT_FOUND };
  return { url: await presignDownload(project.key) };
}

/**
 * Deletes the mesh `sha256` from the user's project when nothing saved refers
 * to it: neither the document nor any version (ADR-0029). For an upload the
 * import then didn't use, such as one that lost the race to another import.
 */
export async function discardMesh(projectId: string, sha256: string): Promise<ActionResult> {
  const userId = await getUserId();
  if (!userId) return { error: SIGNED_OUT };
  const project = await findProject(userId, projectId, sha256);
  if (project.error !== undefined) return { error: project.error };
  const { projectId: id, sha256: hash } = project;
  const uses = { path: ["models"], array_contains: [{ sha256: hash }] };
  const count = await db.$transaction(async (tx) => {
    // Locked so a save can't start referring to the mesh between the check and the delete.
    await lockProject(tx, id);
    const referenced = await tx.project.count({
      where: { id, OR: [{ document: uses }, { versions: { some: { document: uses } } }] },
    });
    if (referenced > 0) return 0;
    const deleted = await tx.projectAsset.deleteMany({ where: { projectId: id, sha256: hash } });
    return deleted.count;
  });
  // Rows go first: an object left behind has no row, which the storage sweep deletes.
  if (count > 0) await deleteObject(project.key);
}
