import { randomBytes } from "node:crypto";
import { constants, copyFile, link, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

/**
 * Writes `bytes` to a temporary file next to `path`, then moves it to
 * `path`, so a failed save never leaves a half-written project: the desktop
 * app's save (ADR-0047). Unless `replace`, fails with `EEXIST` if `path`
 * exists, even if another process creates it meanwhile.
 */
export async function writeFileAtomic(
  path: string,
  bytes: Uint8Array,
  replace = true,
): Promise<void> {
  const temporary = join(dirname(path), `.${basename(path)}.${randomBytes(6).toString("hex")}.tmp`);
  try {
    await writeFile(temporary, bytes);
    if (replace) {
      await rename(temporary, path);
      return;
    }
    try {
      // A hard link never replaces a file, and appears whole.
      await link(temporary, path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") throw error;
      // Drives without hard links (exFAT): still never replaces a file.
      await copyFile(temporary, path, constants.COPYFILE_EXCL);
    }
  } finally {
    await rm(temporary, { force: true });
  }
}
