import "server-only";
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  NotFound,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "@/env";
import { db } from "@/lib/db";

/** How long a presigned upload or download URL works, in seconds. */
const URL_LIFETIME = 15 * 60;

/** Largest STL file accepted, in bytes (PRD-0005 S1). */
export const MAX_MESH_BYTES = env.STL_MAX_FILE_MB * 1_000_000;

/** The most an STL file may hold, as the browser checks it before uploading (PRD-0005 S1). */
export type MeshLimits = { maxBytes: number; maxTriangles: number };

const bucket = env.S3_BUCKET;

/** The storage client, or `null` when the instance has none: STL import is off (ADR-0029). */
const client =
  bucket && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY
    ? new S3Client({
        endpoint: env.S3_ENDPOINT,
        region: env.S3_REGION,
        // Custom endpoints (R2, RustFS, …) are addressed by path; AWS by virtual host.
        forcePathStyle: env.S3_ENDPOINT !== undefined,
        credentials: {
          accessKeyId: env.S3_ACCESS_KEY_ID,
          secretAccessKey: env.S3_SECRET_ACCESS_KEY,
        },
        // Only the checksums we sign ourselves: the SDK's default CRC32 doesn't fit presigned URLs.
        requestChecksumCalculation: "WHEN_REQUIRED",
        responseChecksumValidation: "WHEN_REQUIRED",
      })
    : null;

export function isStorageConfigured() {
  return client !== null;
}

/** What STL files the browser may import, or `null` when import is off: no storage. */
export function meshLimits(): MeshLimits | null {
  return client ? { maxBytes: MAX_MESH_BYTES, maxTriangles: env.STL_MAX_TRIANGLES } : null;
}

function storage() {
  if (!client || !bucket) throw new Error("Storage isn't configured");
  return { client, bucket };
}

/** Objects of every project of a user: deleted with the account. */
export function userPrefix(userId: string) {
  return `${userId}/`;
}

/** Objects of a project: deleted with it. Never shared with other projects (ADR-0029). */
export function projectPrefix(userId: string, projectId: string) {
  return `${userPrefix(userId)}${projectId}/`;
}

export function assetKey(userId: string, projectId: string, sha256: string) {
  return `${projectPrefix(userId, projectId)}${sha256}`;
}

/** The base64 form of a hex SHA-256, as S3 checksums carry it. */
export function checksumOf(sha256: string) {
  return Buffer.from(sha256, "hex").toString("base64");
}

/** What the browser sends to upload a file: the URL and the headers signed into it. */
export type PresignedUpload = { url: string; headers: Record<string, string> };

/**
 * A URL to upload exactly `size` bytes hashing to `sha256` to `key`, once:
 * the storage rejects other bytes and never overwrites an object.
 */
export async function presignUpload(
  key: string,
  size: number,
  sha256: string,
): Promise<PresignedUpload> {
  const { client, bucket } = storage();
  const headers = { "x-amz-checksum-sha256": checksumOf(sha256), "if-none-match": "*" };
  const url = await getSignedUrl(
    client,
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentLength: size,
      ChecksumSHA256: headers["x-amz-checksum-sha256"],
      IfNoneMatch: "*",
    }),
    {
      expiresIn: URL_LIFETIME,
      // Signed as headers, not query parameters, so the request must carry them.
      signableHeaders: new Set(["content-length", ...Object.keys(headers)]),
      unhoistableHeaders: new Set(Object.keys(headers)),
    },
  );
  return { url, headers };
}

export async function presignDownload(key: string) {
  const { client, bucket } = storage();
  return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), {
    expiresIn: URL_LIFETIME,
  });
}

/** Whether the object at `key` is missing, or holds `size` bytes hashing to `sha256`. */
export async function checkObject(
  key: string,
  size: number,
  sha256: string,
): Promise<"missing" | "ok" | "mismatch"> {
  const { client, bucket } = storage();
  try {
    const head = await client.send(
      new HeadObjectCommand({ Bucket: bucket, Key: key, ChecksumMode: "ENABLED" }),
    );
    return head.ContentLength === size && head.ChecksumSHA256 === checksumOf(sha256)
      ? "ok"
      : "mismatch";
  } catch (error) {
    if (error instanceof NotFound) return "missing";
    throw error;
  }
}

/** Copies an object within the bucket, with its SHA-256 checksum. */
export async function copyObject(from: string, to: string) {
  const { client, bucket } = storage();
  await client.send(
    new CopyObjectCommand({
      Bucket: bucket,
      Key: to,
      CopySource: `${bucket}/${from}`,
      ChecksumAlgorithm: "SHA256",
    }),
  );
}

export async function deleteObject(key: string) {
  const { client, bucket } = storage();
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

/** Deletes every object whose key starts with `prefix`. Does nothing without storage. */
export async function deletePrefix(prefix: string) {
  if (!client || !bucket) return;
  let token: string | undefined;
  do {
    const page = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }),
    );
    const objects = (page.Contents ?? []).flatMap(({ Key }) => (Key ? [{ Key }] : []));
    if (objects.length > 0) {
      await client.send(
        new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: objects, Quiet: true } }),
      );
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
}

/**
 * Deletes all of a user's objects after their account is gone. Failures are
 * logged, not thrown: the account is already deleted, so the request must
 * still succeed, and the log says which objects were left behind.
 */
export async function deleteUserObjects(userId: string) {
  try {
    await deletePrefix(userPrefix(userId));
  } catch (error) {
    console.error(`Couldn't delete the objects of deleted user ${userId}`, error);
  }
}

/**
 * Deletes a project's objects after its rows are gone. Failures are logged,
 * not thrown: the project is already deleted, and objects under its prefix
 * can't be reached any more.
 */
export async function deleteProjectObjects(userId: string, projectId: string) {
  try {
    await deletePrefix(projectPrefix(userId, projectId));
  } catch (error) {
    console.error(`Couldn't delete the objects of project ${projectId}`, error);
  }
}

/**
 * The hashes among `sha256s` that the user's project `projectId` has no
 * verified asset for: a document may only reference verified ones (ADR-0029).
 */
export async function missingAssets(
  userId: string,
  projectId: string,
  sha256s: readonly string[],
): Promise<string[]> {
  if (sha256s.length === 0) return [];
  const rows = await db.projectAsset.findMany({
    where: {
      projectId,
      project: { userId },
      sha256: { in: [...sha256s] },
      verifiedAt: { not: null },
    },
    select: { sha256: true },
  });
  const verified = new Set(rows.map(({ sha256 }) => sha256));
  return sha256s.filter((sha256) => !verified.has(sha256));
}

/**
 * Copies the verified meshes `sha256s` of the user's project `from` to their
 * project `to`, as verified assets: projects never share objects (ADR-0029).
 * Throws if a copy fails or doesn't match.
 */
export async function copyAssets(
  userId: string,
  from: string,
  to: string,
  sha256s: readonly string[],
) {
  if (sha256s.length === 0) return;
  const assets = await db.projectAsset.findMany({
    where: { projectId: from, sha256: { in: [...sha256s] }, verifiedAt: { not: null } },
    select: { sha256: true, size: true },
  });
  for (const { sha256, size } of assets) {
    const key = assetKey(userId, to, sha256);
    await copyObject(assetKey(userId, from, sha256), key);
    if ((await checkObject(key, size, sha256)) !== "ok") {
      throw new Error(`The copy of mesh ${sha256} doesn't match`);
    }
  }
  const verifiedAt = new Date();
  await db.projectAsset.createMany({
    data: assets.map(({ sha256, size }) => ({ projectId: to, sha256, size, verifiedAt })),
  });
}
