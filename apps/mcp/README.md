# Furrow CAM MCP server

Lets an AI assistant work on your [Furrow CAM](https://github.com/federicovezzoli/furrow-cam) projects: the `.furrow` files the desktop app opens. It runs on your computer and speaks the [Model Context Protocol](https://modelcontextprotocol.io) over stdio, so any MCP client can start it with one command:

```sh
npx -y @furrow/mcp
```

It needs [Node.js](https://nodejs.org) 22 or later.

## What it can do

| Tool | What it does |
| --- | --- |
| `create_project` | Creates an empty `.furrow` project at a path |
| `open_project` | Opens a `.furrow`, `.furrow.zip` or `.furrow.json` project, dropping changes the server hasn't saved |
| `get_project` | Summarises a project: units, stock and zero, machine, drawings, 3D models and operations with their settings |
| `import_file` | Imports an SVG or DXF drawing, or an STL 3D model, with the app's limits and placement; asks for the DPI or units when the file doesn't give them |
| `fit_to_stock` | Scales a drawing or model to fit inside the stock less its border |
| `resize` | Sets a drawing's or model's width or height, or a model's depth, keeping its proportions |
| `save_project` | Saves the project as `.furrow`, which the desktop app opens; never replaces another file, nor a project changed since it was opened (for example in the app) |

Setting up the stock and tools, adding operations, checking a project and exporting G-code come with the next releases.

The server changes projects with the same code as the app. Before its first change to a project you opened, it keeps the project as it was as a version (*Before the assistant's changes*), which you can restore from the app's versions.

## Privacy and safety

- **Local files only.** The server reads and writes the files you point it at, on your computer. Furrow CAM uploads nothing and the server makes no network requests: no account, no usage tracking.
- **Your assistant decides where results go.** What a tool returns (a project summary, an error) goes to the assistant that called it, which usually sends it to a cloud model. Don't point it at projects you wouldn't share with your assistant.
- **It never talks to your machine.** The server only works on project files. You load and run the G-code yourself, after checking the toolpaths and the simulation in the app.

## Setup

### Claude Desktop

Open *Settings → Developer → Edit Config* and add the server to `claude_desktop_config.json`, then restart Claude Desktop:

```json
{
  "mcpServers": {
    "furrow-cam": {
      "command": "npx",
      "args": ["-y", "@furrow/mcp"]
    }
  }
}
```

On Windows, if Claude Desktop can't find `npx`, use `"command": "cmd"` and `"args": ["/c", "npx", "-y", "@furrow/mcp"]`.

### Claude Code

```sh
claude mcp add furrow-cam --scope user -- npx -y @furrow/mcp
```

`--scope user` makes it available in every project; leave it out to add it to the current one only.

### VS Code

Add the server to `.vscode/mcp.json` in your workspace, or run *MCP: Open User Configuration* to add it for every workspace:

```json
{
  "servers": {
    "furrow-cam": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@furrow/mcp"]
    }
  }
}
```

Then start it from the file's *Start* link, and use it in Copilot Chat's agent mode.

### Other clients

Any MCP client that starts stdio servers works: the command is `npx`, the arguments `-y @furrow/mcp`.

## Using it

The tools take absolute paths, for example: *"Create a project at `/Users/me/signs/rossi.furrow`"*. Changes stay in the server until the assistant saves the project; then open the file in the desktop app to check it.

## Development

From the repository root: `pnpm --filter @furrow/mcp build` bundles the server into `apps/mcp/dist/main.js`, which `node apps/mcp/dist/main.js` runs. See [ADR-0067](https://github.com/federicovezzoli/furrow-cam/blob/main/docs/adr/0067-local-mcp-server.md) for how it is built.

## License

[MIT](https://github.com/federicovezzoli/furrow-cam/blob/main/LICENSE)
