import "server-only";
import { timingSafeEqual } from "node:crypto";
import { env } from "@/env";
import { db } from "@/lib/db";
import {
  assetKey,
  deleteObjects,
  isStorageConfigured,
  listObjects,
  type StoredObject,
  URL_LIFETIME,
} from "./server";

/** How long an upload may stay unverified before the sweep deletes it. */
const UNVERIFIED_LIFETIME = 24 * 60 * 60 * 1000;

/**
 * How old an object must be before the sweep may delete it: once the URL that
 * uploaded it has expired, with an hour's margin for clock skew, nothing more
 * can be written under its key, and copies (`copyAssets`, imports) have
 * long since recorded their rows.
 */
const OBJECT_GRACE = URL_LIFETIME * 1000 + 60 * 60 * 1000;

/** The storage operations the sweep needs, so tests can pass a fake. */
export type SweepStorage = {
  listObjects(): AsyncIterable<StoredObject[]>;
  deleteObjects(keys: readonly string[]): Promise<void>;
};

const s3: SweepStorage = { listObjects: () => listObjects(), deleteObjects };

/**
 * Deletes what uploads leave behind (ADR-0029): unverified assets older than
 * a day, then every object with no asset row, such as one uploaded after its
 * project was deleted. Objects younger than `OBJECT_GRACE` are never touched,
 * so uploads and copies in flight finish. Returns what it deleted, and how
 * many assets it unverified because their object went with an orphan.
 */
export async function sweepAssets(storage: SweepStorage = s3, now = new Date()) {
  const { count: assets } = await db.projectAsset.deleteMany({
    where: { verifiedAt: null, createdAt: { lt: new Date(now.getTime() - UNVERIFIED_LIFETIME) } },
  });

  const cutoff = now.getTime() - OBJECT_GRACE;
  let objects = 0;
  let unverified = 0;
  for await (const page of storage.listObjects()) {
    const old = page.flatMap(({ key, lastModified }) => {
      const parts = key.split("/");
      // Keys are `<userId>/<projectId>/<sha256>`; anything else isn't ours to delete.
      if (parts.length !== 3 || parts.some((part) => part === "")) return [];
      return lastModified.getTime() < cutoff ? [{ key, projectId: parts[1] as string }] : [];
    });
    if (old.length === 0) continue;
    const projectIds = [...new Set(old.map(({ projectId }) => projectId))];
    const kept = new Set((await assetsOf(projectIds)).map(({ key }) => key));
    const orphans = new Set(old.flatMap(({ key }) => (kept.has(key) ? [] : [key])));
    if (orphans.size === 0) continue;
    await storage.deleteObjects([...orphans]);
    const deletedAt = new Date();
    objects += orphans.size;

    // An upload request may have found one of these objects and verified a row for it
    // since the rows were read. That row's object is gone now: unverify it, so the
    // next request uploads the file again instead of trusting it's stored.
    const lost = (await assetsOf(projectIds)).filter(({ key }) => orphans.has(key));
    if (lost.length > 0) {
      const { count } = await db.projectAsset.updateMany({
        where: { id: { in: lost.map(({ id }) => id) }, verifiedAt: { lte: deletedAt } },
        data: { verifiedAt: null },
      });
      unverified += count;
    }
  }

  console.info(
    `Asset sweep: deleted ${assets} unverified assets and ${objects} objects, unverified ${unverified} assets`,
  );
  return { assets, objects, unverified };
}

/** The asset rows of `projectIds`, with their object keys. */
async function assetsOf(projectIds: string[]) {
  const rows = await db.projectAsset.findMany({
    where: { projectId: { in: projectIds } },
    select: { id: true, projectId: true, sha256: true, project: { select: { userId: true } } },
  });
  return rows.map((row) => ({
    id: row.id,
    key: assetKey(row.project.userId, row.projectId, row.sha256),
  }));
}

/** Whether `request` carries `Authorization: Bearer <CRON_SECRET>`, as Vercel Cron sends it. */
function isAuthorized(request: Request) {
  if (!env.CRON_SECRET) return false;
  const expected = Buffer.from(`Bearer ${env.CRON_SECRET}`);
  const actual = Buffer.from(request.headers.get("authorization") ?? "");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** The monthly cron route: sweeps storage, for callers holding the secret. Off without storage. */
export async function handleSweepRequest(request: Request) {
  if (!isAuthorized(request)) return new Response("Unauthorized", { status: 401 });
  if (!isStorageConfigured()) return new Response("Storage isn't configured", { status: 404 });
  return Response.json(await sweepAssets());
}
