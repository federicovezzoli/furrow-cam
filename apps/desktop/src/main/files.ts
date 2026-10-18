import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { RecentFile, Recovery } from "../shared/api";

/** How many recent files the start screen lists. */
export const MAX_RECENT = 10;

/** The name to show for the project file at `path`: its name without the extension. */
export function projectName(path: string): string {
  const name = basename(path)
    .replace(/(\.furrow)?\.(json|zip)$|\.furrow$/i, "")
    .trim();
  return name === "" ? "Untitled" : name;
}

/**
 * Writes `bytes` to a temporary file next to `path`, then renames it over
 * `path`, so a failed save never leaves a half-written project (ADR-0047).
 */
export async function writeFileAtomic(path: string, bytes: Uint8Array | string): Promise<void> {
  const temporary = join(dirname(path), `.${basename(path)}.${randomBytes(6).toString("hex")}.tmp`);
  try {
    await writeFile(temporary, bytes);
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

/** The JSON in `path`, or `null` if it doesn't exist or can't be read as JSON. */
export async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

export async function writeJson(path: string, data: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFileAtomic(path, `${JSON.stringify(data, null, 2)}\n`);
}

/** `recent` with `path` moved to the top, at most `MAX_RECENT` long. */
export function withRecent(recent: readonly RecentFile[], path: string): RecentFile[] {
  return [{ path, name: projectName(path) }, ...recent.filter((file) => file.path !== path)].slice(
    0,
    MAX_RECENT,
  );
}

/** The recent files stored as `json`, leaving out malformed entries. */
export function parseRecent(json: unknown): RecentFile[] {
  if (!Array.isArray(json)) return [];
  return json.flatMap((entry: unknown) =>
    typeof entry === "object" && entry !== null && "path" in entry && typeof entry.path === "string"
      ? [{ path: entry.path, name: projectName(entry.path) }]
      : [],
  );
}

/** `recent` without the files that no longer exist. */
export async function existingRecent(recent: readonly RecentFile[]): Promise<RecentFile[]> {
  const exists = await Promise.all(
    recent.map((file) =>
      stat(file.path).then(
        (info) => info.isFile(),
        () => false,
      ),
    ),
  );
  return recent.filter((_, i) => exists[i]);
}

const RECOVERY_ID = /^[A-Za-z0-9-]{1,64}$/;

/**
 * Crash-recovery copies in folder `dir` (ADR-0047): `<id>.furrow` with the
 * project and `<id>.json` with where it came from. Ids name files, so they
 * are checked first.
 */
export function recoveryStore(dir: string) {
  function paths(id: string) {
    if (!RECOVERY_ID.test(id)) throw new Error(`Invalid recovery id ${JSON.stringify(id)}`);
    return { file: join(dir, `${id}.furrow`), meta: join(dir, `${id}.json`) };
  }

  return {
    async write({ id, path, name }: Omit<Recovery, "savedAt">, bytes: Uint8Array) {
      const { file, meta } = paths(id);
      await mkdir(dir, { recursive: true });
      // The project first: a copy without its description is ignored, not offered half-written.
      await writeFileAtomic(file, bytes);
      const recovery: Recovery = { id, path, name, savedAt: new Date().toISOString() };
      await writeFileAtomic(meta, JSON.stringify(recovery));
    },

    async delete(id: string) {
      const { file, meta } = paths(id);
      await rm(meta, { force: true });
      await rm(file, { force: true });
    },

    async read(id: string): Promise<Uint8Array | null> {
      try {
        return new Uint8Array(await readFile(paths(id).file));
      } catch {
        return null;
      }
    },

    /** Every complete copy, newest first. */
    async list(): Promise<Recovery[]> {
      let names: string[];
      try {
        names = await readdir(dir);
      } catch {
        return [];
      }
      const recoveries: Recovery[] = [];
      for (const name of names) {
        const id = name.match(/^(.+)\.json$/)?.[1];
        if (id === undefined || !RECOVERY_ID.test(id) || !names.includes(`${id}.furrow`)) continue;
        const meta = await readJson(join(dir, name));
        if (isRecovery(meta) && meta.id === id) recoveries.push(meta);
      }
      return recoveries.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
    },
  };
}

function isRecovery(value: unknown): value is Recovery {
  if (typeof value !== "object" || value === null) return false;
  const { id, path, name, savedAt } = value as Record<string, unknown>;
  return (
    typeof id === "string" &&
    (path === null || typeof path === "string") &&
    typeof name === "string" &&
    typeof savedAt === "string"
  );
}

/** The project files among command-line `args`, e.g. from a double-click on Windows or Linux. */
export function projectPathsIn(args: readonly string[]): string[] {
  return args.filter((arg) => !arg.startsWith("-") && /\.furrow(\.(json|zip))?$/i.test(arg));
}
