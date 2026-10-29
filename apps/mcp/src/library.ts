import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseMachines, parseTools } from "@furrow/workspace/lib/local-library";
import type { MachineChoice, ToolChoice } from "@furrow/workspace/lib/workspace-host";

/** The desktop app's name, which names its data folder (Electron's `userData`). */
const APP_NAME = "Furrow CAM";

/**
 * The desktop app's data folder (ADR-0047), where its tool library and
 * machine list are: Electron's `userData` for an app named "Furrow CAM",
 * found without Electron.
 */
export function libraryDir(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  home = homedir(),
): string {
  if (platform === "darwin") return join(home, "Library", "Application Support", APP_NAME);
  if (platform === "win32") return join(env.APPDATA ?? join(home, "AppData", "Roaming"), APP_NAME);
  return join(env.XDG_CONFIG_HOME || join(home, ".config"), APP_NAME);
}

/** The desktop app's tool library and machine list, and what kept any of them from being read. */
export type Library = { tools: ToolChoice[]; machines: MachineChoice[]; problems: string[] };

/**
 * Reads `tools.json` and `machines.json` from `dir` as the desktop app does,
 * leaving out entries that fail today's rules. A missing or unreadable file,
 * or entries left out, are reported in `problems`, never thrown.
 */
export async function readLibrary(dir: string): Promise<Library> {
  const problems: string[] = [];

  async function read<T>(name: string, parse: (json: unknown) => T[]): Promise<T[]> {
    const path = join(dir, name);
    let json: unknown;
    try {
      json = JSON.parse(await readFile(path, "utf8"));
    } catch (error) {
      problems.push(
        (error as NodeJS.ErrnoException).code === "ENOENT"
          ? `${path} doesn't exist: the desktop app writes it once its library has been changed.`
          : `${path} can't be read: ${(error as Error).message}`,
      );
      return [];
    }
    if (!Array.isArray(json)) {
      problems.push(`${path} isn't a list: it is ignored, as the app ignores it.`);
      return [];
    }
    const entries = parse(json);
    if (entries.length < json.length) {
      problems.push(
        `${path}: ${json.length - entries.length} entries left out, as the app leaves them out: they don't match today's rules.`,
      );
    }
    return entries;
  }

  const tools = await read("tools.json", parseTools);
  const machines = await read("machines.json", parseMachines);
  return { tools, machines, problems };
}
