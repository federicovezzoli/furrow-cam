import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addServer, clientStatus, type McpClient, mcpClients, SERVER_NAME } from "./mcp-setup";

let home: string;
let clients: McpClient[];

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "furrow-mcp-setup-"));
  clients = mcpClients("linux", {}, home);
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

const client = (name: string) => clients.find((c) => c.name === name) as McpClient;
const json = async (path: string) => JSON.parse(await readFile(path, "utf8"));

describe("mcpClients", () => {
  it("finds each client's user-wide config where it keeps it", () => {
    expect(mcpClients("darwin", {}, "/Users/me").map((c) => c.config)).toEqual([
      "/Users/me/Library/Application Support/Claude/claude_desktop_config.json",
      "/Users/me/.claude.json",
      "/Users/me/Library/Application Support/Code/User/mcp.json",
    ]);
    expect(mcpClients("linux", { XDG_CONFIG_HOME: "/cfg" }, "/home/me")[0]?.config).toBe(
      "/cfg/Claude/claude_desktop_config.json",
    );
  });

  it("starts npx through cmd for Claude Desktop on Windows", () => {
    const [desktop] = mcpClients("win32", { APPDATA: "C:\\AppData" }, "C:\\Users\\me");
    expect(desktop?.entry).toEqual({
      command: "cmd",
      args: ["/c", "npx", "-y", "@furrow-cam/mcp"],
    });
  });
});

describe("clientStatus and addServer", () => {
  it("finds no client that isn't installed", async () => {
    expect(await Promise.all(clients.map(clientStatus))).toEqual(["absent", "absent", "absent"]);
  });

  it("adds the server to an installed client with no config yet", async () => {
    const desktop = client("Claude Desktop");
    await mkdir(join(home, ".config", "Claude"), { recursive: true });
    expect(await clientStatus(desktop)).toBe("ready");
    await addServer(desktop);
    expect(await json(desktop.config)).toEqual({
      mcpServers: { [SERVER_NAME]: { command: "npx", args: ["-y", "@furrow-cam/mcp"] } },
    });
    expect(await clientStatus(desktop)).toBe("added");
  });

  it("keeps everything else in the config", async () => {
    const code = client("Claude Code");
    await writeFile(
      code.config,
      JSON.stringify({ numStartups: 4, mcpServers: { other: { command: "other" } } }),
    );
    await addServer(code);
    expect(await json(code.config)).toEqual({
      numStartups: 4,
      mcpServers: {
        other: { command: "other" },
        [SERVER_NAME]: { type: "stdio", command: "npx", args: ["-y", "@furrow-cam/mcp"] },
      },
    });
  });

  it("leaves alone a config it can't read as JSON", async () => {
    const vscode = client("VS Code");
    await mkdir(join(home, ".config", "Code", "User"), { recursive: true });
    const commented = '{\n  // my servers\n  "servers": {}\n}\n';
    await writeFile(vscode.config, commented);
    expect(await clientStatus(vscode)).toBe("unreadable");
    await expect(addServer(vscode)).rejects.toThrow();
    expect(await readFile(vscode.config, "utf8")).toBe(commented);
  });
});
