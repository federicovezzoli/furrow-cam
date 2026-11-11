# Furrow CAM MCP server

Lets an AI assistant work on your [Furrow CAM](https://github.com/federicovezzoli/furrow-cam) projects: the `.furrow` files the desktop app opens. It runs on your computer and speaks the [Model Context Protocol](https://modelcontextprotocol.io) over stdio, so any MCP client can start it with one command:

```sh
npx -y @furrow-cam/mcp
```

It needs [Node.js](https://nodejs.org) 22.2 or later.

## What it can do

| Tool | What it does |
| --- | --- |
| `create_project` | Creates an empty `.furrow` project at a path |
| `open_project` | Opens a `.furrow`, `.furrow.zip` or `.furrow.json` project, dropping changes the server hasn't saved |
| `get_project` | Summarises a project: units, stock and zero, machine, drawings, 3D models and operations with their settings |
| `save_project` | Saves a project opened from a `.furrow.zip` or `.furrow.json` as `.furrow`, or saves one to another path; never replaces another file, nor a project changed since it was read (for example in the app) |
| `import_file` | Imports an SVG or DXF drawing, or an STL or STEP 3D model, with the app's limits and placement; asks for the DPI or units when the file doesn't give them |
| `import_terrain` | Makes a relief model of a real place from open elevation data, as the app's *Terrain from a map* does: an area about coordinates or a map link (names aren't searched), at the size, exaggeration and base you give; can also write it as an STL file |
| `import_image_relief` | Makes a relief model from a greyscale PNG, JPEG or WebP image, as the app's *Relief from image* does: lighter is higher (darker with invert), at the width, relief height, base and smoothing you give |
| `fit_to_stock` | Scales a drawing or model to fit inside the stock less its border |
| `resize` | Sets a drawing's or model's width or height, or a model's depth, keeping its proportions |
| `set_model_top` | Sinks a model's top below the stock top |
| `turn_model` | Turns a model a quarter turn (or more) about the stock's X, Y or Z axis |
| `set_stock` | Sets the stock's size and the units the app shows |
| `set_two_sided` | Makes the project two-sided and sets its flip axis, parting depth, line-up and holding tabs |
| `set_zero` | Sets the XY zero (a stock corner, edge or centre, or a custom point) and the Z zero |
| `set_touch_off_pad` | Adds, moves or removes the touch-off pad |
| `get_library` | Lists the desktop app's tool library and machines |
| `set_machine` | Copies a machine from the desktop app's list into the project |
| `add_profile`, `add_pocket`, `add_drill`, `add_engrave`, `add_vcarve`, `add_relief_rough`, `add_relief_finish` | Adds an operation with the app's defaults and a tool from the library or given by its settings, then changes any settings given (depth, side, tabs, strategy, …) |
| `edit_operation` | Renames an operation, enables or disables it, changes what it cuts and its settings |
| `set_operation_tool` | Gives an operation another tool |
| `move_operation`, `remove_operation` | Reorders or removes operations |
| `check_project` | Computes the toolpaths and reports what the app would show: tool problems, warnings, and whether there is anything to export |
| `get_top_view` | Draws one side from above as a PNG image (the stock, the drawings and each operation's toolpath in its tool's colour), so the assistant can show you what it built or check it |
| `export_gcode` | Writes the project's G-code, byte for byte what the app exports |

An operation the app wouldn't accept (a drill bit in a pocket, a finishing pass with no allowance) is refused with the app's message, and nothing changes.

Each change to a project opened from its own `.furrow` file is saved to the file as it's made, so the desktop app, if it has the project open, shows it at once. If you have unsaved changes there, the app asks before loading the assistant's. Changes you save in the app are picked up before the assistant's next one.

The server changes projects with the same code as the app. Before its first change to a project you opened, it keeps the project as it was as a version (*Before the assistant's changes*), which you can restore from the app's versions.

## Privacy and safety

- **Local files only.** The server reads and writes the files you point it at, on your computer. Furrow CAM uploads nothing: no account, no usage tracking.
- **One tool uses the network.** `import_terrain` downloads the area's elevation tiles from [Mapterhorn](https://mapterhorn.com/privacy-policy/), which receives your IP address and which tiles they are; nothing else is sent, and no other tool makes network requests.
- **Your assistant decides where results go.** What a tool returns (a project summary, an error) goes to the assistant that called it, which usually sends it to a cloud model. Don't point it at projects you wouldn't share with your assistant.
- **It never talks to your machine.** The server only works on project files. You load and run the G-code yourself, after checking the toolpaths and the simulation in the app.

## Setup

Using the Furrow CAM desktop app? *Help → Set Up AI Assistants…* adds the server to Claude Desktop and VS Code for you, after asking, and gives you the command for Claude Code. Otherwise, add it by hand:

### Claude Desktop

Open *Settings → Developer → Edit Config* and add the server to `claude_desktop_config.json`, then restart Claude Desktop:

```json
{
  "mcpServers": {
    "furrow-cam": {
      "command": "npx",
      "args": ["-y", "@furrow-cam/mcp"]
    }
  }
}
```

On Windows, if Claude Desktop can't find `npx`, use `"command": "cmd"` and `"args": ["/c", "npx", "-y", "@furrow-cam/mcp"]`.

### Claude Code

```sh
claude mcp add furrow-cam --scope user -- npx -y @furrow-cam/mcp
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
      "args": ["-y", "@furrow-cam/mcp"]
    }
  }
}
```

Then start it from the file's *Start* link, and use it in Copilot Chat's agent mode.

### Other clients

Any MCP client that starts stdio servers works: the command is `npx`, the arguments `-y @furrow-cam/mcp`.

## Using it

The tools take absolute paths, for example: *"Create a project at `/Users/me/signs/rossi.furrow`"*. Changes stay in the server until the assistant saves the project; then open the file in the desktop app to check it.

## Development

From the repository root: `pnpm --filter @furrow/mcp build` bundles the server into `apps/mcp/dist/main.js`, which `node apps/mcp/dist/main.js` runs. See [ADR-0067](https://github.com/federicovezzoli/furrow-cam/blob/main/docs/adr/0067-local-mcp-server.md) for how it is built.

## License

[MIT](https://github.com/federicovezzoli/furrow-cam/blob/main/LICENSE)
