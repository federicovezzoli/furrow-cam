# @furrow/mcp

## 0.1.0

### Minor Changes

- An assistant can now check a project for the problems the app shows and export its G-code through the MCP server, byte for byte what the app exports. ([#419](https://github.com/federicovezzoli/furrow-cam/pull/419))
- An assistant can now import SVG and DXF drawings and STL models into a project through the MCP server, and resize them or fit them to the stock, with the same limits and placement as the app. ([#416](https://github.com/federicovezzoli/furrow-cam/pull/416))
- Add a local MCP server through which an AI assistant can create, open, summarise and save Furrow CAM projects on your computer. Before its first change to a project, the project is kept as a version you can restore. ([#415](https://github.com/federicovezzoli/furrow-cam/pull/415))
- An assistant can now set a project's stock, units, zero and touch-off pad through the MCP server, read the desktop app's tool library and machines, choose the project's machine and give an operation a tool. ([#418](https://github.com/federicovezzoli/furrow-cam/pull/418))

### Patch Changes

- Updated dependencies: @furrow/post@0.13.0, @furrow/workspace@0.16.0, @furrow/ui@0.5.0
