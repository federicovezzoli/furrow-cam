# @furrow/mcp

## 0.7.2

### Patch Changes

- Drawings, shapes and models can be hidden or locked, and the project remembers it. A hidden object isn't drawn or cut, and an operation that cuts one turns off until it is shown again; a locked one stays in view but can't be picked or moved. ([#542](https://github.com/federicovezzoli/furrow-cam/pull/542))

## 0.7.1

### Patch Changes

- The MCP server can make a project two-sided and set its flip axis, parting depth, line-up (locating pins or a fence corner) and holding tabs, so an AI assistant can plan a two-sided job from scratch. A list that is too short now says how many items it needs, not how many characters. ([#530](https://github.com/federicovezzoli/furrow-cam/pull/530))
- The MCP server can turn a model in the stock in quarter turns about X, Y or Z, as the app's turn buttons do, so an AI assistant can stand up a model exported lying on its side. ([#529](https://github.com/federicovezzoli/furrow-cam/pull/529))

## 0.7.0

### Minor Changes

- A project can now hold drawings and a 3D model together, so a relief and the profile that cuts it out live in one project. The ribbon gets a button to import a model at any time. ([#509](https://github.com/federicovezzoli/furrow-cam/pull/509))

### Patch Changes

- Projects now remember which of your machines they use, and offer to update their copy when you open them after editing that machine. ([#520](https://github.com/federicovezzoli/furrow-cam/pull/520))

## 0.6.0

### Minor Changes

- The MCP server saves each change to a project's .furrow file as it's made, so the desktop app shows it live, and picks up changes you saved in the app before its next one. ([#496](https://github.com/federicovezzoli/furrow-cam/pull/496))

### Patch Changes

- The MCP server now notices when a project file was saved by another program within the same second, even if its size didn't change, and won't save over it. ([#493](https://github.com/federicovezzoli/furrow-cam/pull/493))

## 0.5.0

### Minor Changes

- An assistant can now add, edit, reorder, disable and remove operations of every type through the MCP server, with the app's defaults, and anything the app wouldn't accept is refused with its message. ([#487](https://github.com/federicovezzoli/furrow-cam/pull/487))
- An assistant can now ask the MCP server for a picture of the project from above, with each operation's toolpath in its tool's colour, to show you what it built or to check it. ([#488](https://github.com/federicovezzoli/furrow-cam/pull/488))

## 0.4.0

### Minor Changes

- The MCP server is published to npm: add it to Claude Desktop, Claude Code, VS Code or another MCP client with `npx -y @furrow-cam/mcp`, following the setup guide in its README. ([#417](https://github.com/federicovezzoli/furrow-cam/pull/417))

## 0.3.6

### Patch Changes

- Updated dependencies: @furrow/workspace@0.22.0, @furrow/document@0.21.0, @furrow/cam-core@0.19.0, @furrow/ui@0.8.3, @furrow/post@0.15.3

## 0.3.5

### Patch Changes

- Updated dependencies: @furrow/workspace@0.21.2

## 0.3.4

### Patch Changes

- Updated dependencies: @furrow/workspace@0.21.1

## 0.3.3

### Patch Changes

- Updated dependencies: @furrow/workspace@0.21.0, @furrow/ui@0.8.2

## 0.3.2

### Patch Changes

- Updated dependencies: @furrow/document@0.20.0, @furrow/cam-core@0.18.0, @furrow/workspace@0.20.0, @furrow/ui@0.8.1, @furrow/post@0.15.2

## 0.3.1

### Patch Changes

- Updated dependencies: @furrow/workspace@0.19.0, @furrow/document@0.19.0, @furrow/cam-core@0.17.0, @furrow/ui@0.8.0, @furrow/post@0.15.1

## 0.3.0

### Minor Changes

- Exported G-code files are named after the project, the version you last saved or restored (until you change the project) and the date, e.g. `cutting-board-final-2026-11-01-top.gcode`, so exports no longer collide and are easy to tell apart on the machine. ([#452](https://github.com/federicovezzoli/furrow-cam/pull/452))
- STEP files (`.step`, `.stp`) from CAD programs such as Fusion, FreeCAD or Onshape can now be imported as 3D models, in their true size whatever unit they were drawn in, and machined like STL reliefs. ([#446](https://github.com/federicovezzoli/furrow-cam/pull/446))

### Patch Changes

- Updated dependencies: @furrow/post@0.15.0, @furrow/workspace@0.18.0, @furrow/document@0.18.0, @furrow/ui@0.7.0, @furrow/cam-core@0.16.1

## 0.2.0

### Minor Changes

- A model can now sit below the stock top: set *Top below stock* in its properties to machine the whole relief deeper without stretching it, for example to recover a part or to leave a raised border. ([#436](https://github.com/federicovezzoli/furrow-cam/pull/436))
- Tapered ball-nose bits are a new bit type, described by their angle per side, tip diameter and flute length: 3D finishing and engraving cut with their real shape, ball tip and cone, so steep walls are no longer gouged in the preview. Projects that use them need this release to open. ([#430](https://github.com/federicovezzoli/furrow-cam/pull/430))

### Patch Changes

- Updated dependencies: @furrow/ui@0.6.0, @furrow/workspace@0.17.0, @furrow/document@0.17.0, @furrow/cam-core@0.16.0, @furrow/post@0.14.0

## 0.1.0

### Minor Changes

- An assistant can now check a project for the problems the app shows and export its G-code through the MCP server, byte for byte what the app exports. ([#419](https://github.com/federicovezzoli/furrow-cam/pull/419))
- An assistant can now import SVG and DXF drawings and STL models into a project through the MCP server, and resize them or fit them to the stock, with the same limits and placement as the app. ([#416](https://github.com/federicovezzoli/furrow-cam/pull/416))
- Add a local MCP server through which an AI assistant can create, open, summarise and save Furrow CAM projects on your computer. Before its first change to a project, the project is kept as a version you can restore. ([#415](https://github.com/federicovezzoli/furrow-cam/pull/415))
- An assistant can now set a project's stock, units, zero and touch-off pad through the MCP server, read the desktop app's tool library and machines, choose the project's machine and give an operation a tool. ([#418](https://github.com/federicovezzoli/furrow-cam/pull/418))

### Patch Changes

- Updated dependencies: @furrow/post@0.13.0, @furrow/workspace@0.16.0, @furrow/ui@0.5.0
