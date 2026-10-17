import "server-only";
import { env } from "@/env";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";

/**
 * Freemium usage limits (PRD-0003, ADR-0017): optional limits on each
 * user's projects, tools and machines, and on their G-code exports a day.
 * The only reader of the `FREEMIUM_*` variables.
 */

/** What the free plan limits the number of. */
export type LimitedResource = "projects" | "tools" | "machines";

export type FreemiumLimits = Record<LimitedResource | "dailyExports", number>;

/** The limits, or `null` with the flag off: then nothing is limited (F1, F9). */
export function freemiumLimits(): FreemiumLimits | null {
  if (!env.FREEMIUM_ENABLED) return null;
  // `env.ts` refuses to start with the flag on and a limit unset.
  return {
    projects: env.FREEMIUM_MAX_PROJECTS as number,
    tools: env.FREEMIUM_MAX_TOOLS as number,
    machines: env.FREEMIUM_MAX_MACHINES as number,
    dailyExports: env.FREEMIUM_MAX_DAILY_EXPORTS as number,
  };
}

const NOUNS: Record<LimitedResource, [one: string, many: string]> = {
  projects: ["project", "projects"],
  tools: ["bit", "bits"],
  machines: ["machine", "machines"],
};

/** What a refused create says (F3). */
export function limitMessage(resource: LimitedResource, limit: number): string {
  const [one, many] = NOUNS[resource];
  return `You've reached the free plan's limit of ${limit} ${limit === 1 ? one : many}. Delete a ${one} to create a new one.`;
}

type Client = Prisma.TransactionClient;

/** How many of `resource` the user has. */
function count(client: Client, userId: string, resource: LimitedResource): Promise<number> {
  const where = { where: { userId } };
  if (resource === "projects") return client.project.count(where);
  if (resource === "tools") return client.tool.count(where);
  return client.machine.count(where);
}

/** How much of each limit the user has used, or `null` with the flag off (F8, F9). */
export async function usage(
  userId: string,
): Promise<Record<LimitedResource, { used: number; limit: number }> | null> {
  const limits = freemiumLimits();
  if (!limits) return null;
  const [projects, tools, machines] = await Promise.all(
    (["projects", "tools", "machines"] as const).map((resource) => count(db, userId, resource)),
  );
  return {
    projects: { used: projects as number, limit: limits.projects },
    tools: { used: tools as number, limit: limits.tools },
    machines: { used: machines as number, limit: limits.machines },
  };
}

/**
 * Inside a transaction `tx`: with the flag on, locks the user's row, so
 * concurrent creates take turns, and says why the user may not create
 * another `resource` when they have as many as the limit or more (F3). Items
 * above a limit stay usable; only creating is refused (F4). With the flag
 * off, `null` with no query (F9).
 */
export async function limitError(
  tx: Client,
  userId: string,
  resource: LimitedResource,
): Promise<string | null> {
  const limits = freemiumLimits();
  if (!limits) return null;
  await tx.$queryRaw`SELECT 1 FROM "user" WHERE "id" = ${userId} FOR UPDATE`;
  const limit = limits[resource];
  return (await count(tx, userId, resource)) >= limit ? limitMessage(resource, limit) : null;
}

/**
 * Creates one of the user's `resource` with `create` unless the limit
 * forbids it: with the flag on, the count and the insert share a transaction
 * that locks the user's row (`limitError`), so concurrent requests can't
 * exceed it. With the flag off, `create` runs on the database as it would
 * without limits, with no extra query.
 */
export async function createWithinLimit<T>(
  userId: string,
  resource: LimitedResource,
  create: (client: Client) => Promise<T>,
): Promise<{ created: T; error?: never } | { error: string }> {
  if (!freemiumLimits()) return { created: await create(db) };
  return db.$transaction(async (tx) => {
    const error = await limitError(tx, userId, resource);
    return error ? { error } : { created: await create(tx) };
  });
}
