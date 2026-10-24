"use server";

import { MAX_FONT_BYTES, Sha256 } from "@furrow/document";
import type { KeyMessage } from "@furrow/ui/lib/i18n";
import { getUserId } from "@/features/auth/server";
import { lockProject, parseProjectId } from "@/features/projects/server";
import { db } from "@/lib/db";
import { type ActionResult, signedOut } from "@/lib/form-data";
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

const notFound: KeyMessage = { key: "Projects.notFound" };
const noStorage: KeyMessage = { key: "Assets.noStorage" };
const assetNotFound: KeyMessage = { key: "Assets.notUploaded" };
const mismatch: KeyMessage = { key: "Assets.mismatch" };

/** The kinds of project asset (ADR-0029, ADR-0062): they differ only in the largest file taken. */
export type AssetKind = "mesh" | "font";

/** The largest file of each kind, in bytes. */
function maxBytes(kind: AssetKind) {
  return kind === "font" ? MAX_FONT_BYTES : MAX_MESH_BYTES;
}

/**
 * The asset and object key of file `sha256` in the user's project, or why
 * there is none: no storage, a malformed id or hash, or someone else's project.
 */
async function findProject(
  userId: string,
  projectId: unknown,
  sha256: unknown,
): Promise<
  { projectId: string; sha256: string; key: string; error?: never } | { error: KeyMessage }
> {
  if (!isStorageConfigured()) return { error: noStorage };
  const id = parseProjectId(projectId);
  if (!id) return { error: notFound };
  const hash = Sha256.safeParse(sha256);
  if (!hash.success) return { error: { key: "Assets.invalidHash" } };
  const project = await db.project.findFirst({ where: { id, userId }, select: { id: true } });
  if (!project) return { error: notFound };
  return { projectId: id, sha256: hash.data, key: assetKey(userId, id, hash.data) };
}

async function markVerified(projectId: string, sha256: string) {
  await db.projectAsset.update({
    where: { projectId_sha256: { projectId, sha256 } },
    data: { verifiedAt: new Date() },
  });
}

/**
 * Starts uploading a `kind` file of `size` bytes hashing to `sha256`
 * (lowercase hex) to the user's project (ADR-0029, ADR-0062). Returns where
 * the browser uploads it; call `verifyAssetUpload` afterwards. `uploaded`
 * comes back instead when the project already has it, and nothing needs
 * uploading.
 */
export async function requestAssetUpload(
  projectId: string,
  sha256: string,
  size: number,
  kind: AssetKind,
): Promise<
  | { upload: PresignedUpload; uploaded?: never; error?: never }
  | { uploaded: true; upload?: never; error?: never }
  | { error: KeyMessage }
> {
  const userId = await getUserId();
  if (!userId) return { error: signedOut };
  const project = await findProject(userId, projectId, sha256);
  if (project.error !== undefined) return { error: project.error };
  if (!Number.isSafeInteger(size) || size <= 0) return { error: { key: "Assets.empty" } };
  const max = maxBytes(kind);
  if (size > max) return { error: { key: "Assets.tooLarge", values: { mb: max / 1_000_000 } } };

  const where = { projectId_sha256: { projectId: project.projectId, sha256: project.sha256 } };
  // Retrying an unverified upload restarts its day before the sweep deletes it.
  await db.projectAsset.updateMany({
    where: { projectId: project.projectId, sha256: project.sha256, verifiedAt: null },
    data: { createdAt: new Date() },
  });
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
 * Checks that the file `sha256` the browser uploaded is stored, with the size
 * and hash requested, so documents may reference it (ADR-0029).
 */
export async function verifyAssetUpload(projectId: string, sha256: string): Promise<ActionResult> {
  const userId = await getUserId();
  if (!userId) return { error: signedOut };
  const project = await findProject(userId, projectId, sha256);
  if (project.error !== undefined) return { error: project.error };
  const asset = await db.projectAsset.findUnique({
    where: { projectId_sha256: { projectId: project.projectId, sha256: project.sha256 } },
    select: { size: true, verifiedAt: true },
  });
  if (!asset) return { error: assetNotFound };
  if (asset.verifiedAt) return;

  const stored = await checkObject(project.key, asset.size, project.sha256);
  if (stored === "missing") return { error: assetNotFound };
  if (stored === "mismatch") {
    await deleteObject(project.key);
    return { error: mismatch };
  }
  await markVerified(project.projectId, project.sha256);
}

/** A short-lived URL to download the file `sha256` of the user's project. */
export async function getAssetUrl(
  projectId: string,
  sha256: string,
): Promise<{ url: string; error?: never } | { error: KeyMessage }> {
  const userId = await getUserId();
  if (!userId) return { error: signedOut };
  const project = await findProject(userId, projectId, sha256);
  if (project.error !== undefined) return { error: project.error };
  const asset = await db.projectAsset.findFirst({
    where: { projectId: project.projectId, sha256: project.sha256, verifiedAt: { not: null } },
    select: { id: true },
  });
  if (!asset) return { error: assetNotFound };
  return { url: await presignDownload(project.key) };
}

/**
 * Deletes the file `sha256` from the user's project when nothing saved refers
 * to it: no model or font of the document or any version (ADR-0029,
 * ADR-0062). For an upload the import then didn't use, such as one that lost
 * the race to another import.
 */
export async function discardAsset(projectId: string, sha256: string): Promise<ActionResult> {
  const userId = await getUserId();
  if (!userId) return { error: signedOut };
  const project = await findProject(userId, projectId, sha256);
  if (project.error !== undefined) return { error: project.error };
  const { projectId: id, sha256: hash } = project;
  // A hash names one file, which a model or a font lists.
  const uses = ["models", "fonts"].map((list) => ({
    path: [list],
    array_contains: [{ sha256: hash }],
  }));
  const count = await db.$transaction(async (tx) => {
    // Locked so a save can't start referring to the file between the check and the delete.
    await lockProject(tx, id);
    const referenced = await tx.project.count({
      where: {
        id,
        OR: uses.flatMap((document) => [{ document }, { versions: { some: { document } } }]),
      },
    });
    if (referenced > 0) return 0;
    const deleted = await tx.projectAsset.deleteMany({ where: { projectId: id, sha256: hash } });
    return deleted.count;
  });
  // Rows go first: an object left behind has no row, which the storage sweep deletes.
  if (count > 0) await deleteObject(project.key);
}
