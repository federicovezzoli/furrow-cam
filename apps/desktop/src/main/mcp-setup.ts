import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { writeJson } from "./files";

/** The name the server is added under, as the MCP server's README sets it up. */
export const SERVER_NAME = "furrow-cam";

const NPX = { command: "npx", args: ["-y", "@furrow-cam/mcp"] };

/** An MCP client the app can add the local MCP server to (PRD-0012 M12). */
export type McpClient = {
  name: string;
  /** Found when this exists: the client's own folder or file. */
  marker: string;
  /** The JSON file its servers are listed in. */
  config: string;
  /** The key of that file's server list. */
  key: "mcpServers" | "servers";
  /** The server's entry in that list. */
  entry: Record<string, unknown>;
};

/**
 * The clients whose config the app edits, with the files they keep their
 * user-wide servers in: Claude Desktop's config and VS Code's user `mcp.json`.
 * Not Claude Code: its `~/.claude.json` holds much more, rewritten while it
 * runs, so it gets `CLAUDE_CODE_COMMAND` to run instead.
 */
export function mcpClients(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  home = homedir(),
): McpClient[] {
  const appData =
    platform === "darwin"
      ? join(home, "Library", "Application Support")
      : platform === "win32"
        ? (env.APPDATA ?? join(home, "AppData", "Roaming"))
        : env.XDG_CONFIG_HOME || join(home, ".config");
  return [
    {
      name: "Claude Desktop",
      marker: join(appData, "Claude"),
      config: join(appData, "Claude", "claude_desktop_config.json"),
      key: "mcpServers",
      // Claude Desktop on Windows can't start `npx`, a script, without a shell.
      entry:
        platform === "win32" ? { command: "cmd", args: ["/c", NPX.command, ...NPX.args] } : NPX,
    },
    {
      name: "VS Code",
      marker: join(appData, "Code", "User"),
      config: join(appData, "Code", "User", "mcp.json"),
      key: "servers",
      entry: { type: "stdio", ...NPX },
    },
  ];
}

/** The command that adds the server to Claude Code for every project, as its README gives it. */
export const CLAUDE_CODE_COMMAND = `claude mcp add ${SERVER_NAME} --scope user -- ${NPX.command} ${NPX.args.join(" ")}`;

/** Whether Claude Code has been used on this computer: it keeps `~/.claude.json`. */
export function claudeCodeInstalled(home = homedir()): Promise<boolean> {
  return exists(join(home, ".claude.json"));
}

const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

/**
 * Whether a client is installed (`absent` if not), already has the server
 * (`added`), can have it added (`ready`), or has a config file the app
 * can't read as JSON and leaves alone (`unreadable`: e.g. VS Code's, which
 * may hold comments).
 */
export type ClientStatus = "absent" | "ready" | "added" | "unreadable";

type Config =
  | { status: "ready" | "added"; json: Record<string, unknown> }
  | { status: "unreadable" };

async function readConfig({ config, key }: McpClient): Promise<Config> {
  let text: string;
  try {
    text = await readFile(config, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { status: "ready", json: {} };
    return { status: "unreadable" };
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { status: "unreadable" };
  }
  const servers = (json as Record<string, unknown> | null)?.[key];
  if (
    typeof json !== "object" ||
    json === null ||
    Array.isArray(json) ||
    (servers !== undefined &&
      (typeof servers !== "object" || servers === null || Array.isArray(servers)))
  ) {
    return { status: "unreadable" };
  }
  const added = servers !== undefined && SERVER_NAME in (servers as object);
  return { status: added ? "added" : "ready", json: json as Record<string, unknown> };
}

export async function clientStatus(client: McpClient): Promise<ClientStatus> {
  return (await exists(client.marker)) ? (await readConfig(client)).status : "absent";
}

/**
 * Adds the server to `client`'s config, keeping everything else in it, read
 * again just before writing. Throws if the file can't be read as JSON or
 * written.
 */
export async function addServer(client: McpClient): Promise<void> {
  const config = await readConfig(client);
  if (config.status === "unreadable")
    throw new Error(`${client.config} isn't JSON the app can read`);
  if (config.status === "added") return;
  const servers = (config.json[client.key] ?? {}) as Record<string, unknown>;
  await writeJson(client.config, {
    ...config.json,
    [client.key]: { ...servers, [SERVER_NAME]: client.entry },
  });
}
