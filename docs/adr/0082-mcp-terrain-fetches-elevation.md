# ADR-0082: The MCP server makes terrain, fetching only elevation tiles while its tool runs

- **Status:** Proposed
- **Date:** 2026-11-11
- **Deciders:** Federico Vezzoli
- **Related:** PRD-0012, PRD-0014, ADR-0013, ADR-0067, ADR-0072, ADR-0076, ADR-0077; supersedes in part ADR-0067 ("makes no network requests")

## Context

PRD-0014 turns an area picked on a map into a relief model, and left the MCP server out because ADR-0067 says the server "makes no network requests". Yet "carve the Grignetta, 200 mm, on this pine panel" is exactly the kind of brief PRD-0012 is for, and today the assistant can only ask the user to make the terrain in the app, download the STL and hand its path to `import_file`.

Most of the work is already headless. `planTerrain` and `terrainMesh` (`@furrow/cam-core`, `import/terrain/`) are pure; `loadTerrainTiles` (`@furrow/workspace/lib/terrain-tiles`) fetches tiles through a function it is given; `parsePlace` (`lib/place-search`) reads coordinates and full Google Maps or OpenStreetMap links locally; the generated STL goes into the project like any model (ADR-0077), which the server already imports for STL and STEP files. Only two things are tied to the browser: the mesh worker decodes each WebP tile with `createImageBitmap` and an `OffscreenCanvas`, which Node lacks, and the tiles come from Mapterhorn over the network (ADR-0076).

## Options considered

1. **Keep terrain out of the server.** Pros: the server stays offline. Cons: the assistant can't do a whole relief job, and the user must leave it for the app, then come back.
2. **A terrain tool that fetches only the elevation tiles, only while it runs.** Pros: the same mesh as the app, from the same code; one host contacted, and only when the assistant calls the tool, which MCP clients show to the user, and usually ask them to approve, before it runs. Cons: the server is no longer offline, and a WebP decoder joins its dependencies.
3. **The same, with place search through Photon as well.** Pros: the assistant can pass a place name. Cons: a second third party that receives what is searched, and Photon asks to "be fair" with a community service that isn't meant for automated clients (ADR-0076); assistants usually know a place's coordinates, or the user can paste a link.

## Decision

We will use option 2.

- **The tool.** `import_terrain` adds a terrain as the project's model, with the app's rules: refused in a project that already has a model (PRD-0005, ADR-0078), placed at the chosen size and centred on the stock, not refitted (PRD-0014 T5), named `<name>.stl`, "Terrain" if no name is given. It takes:
  - the area: a centre (decimal coordinates, or a full Google Maps or OpenStreetMap link, read by `parsePlace`; never searched, and short links refused as in the app), a shape (`rectangle` or `ellipse`; a square or a circle is one with equal sides) and its width and depth in km; or a ring of longitude, latitude points for any other shape;
  - the settings of PRD-0014 T4, with the app's defaults: the longest side (fitting the stock less the model border), the exaggeration (1.5×, 1× to 10×) and the base (3 mm);
  - optionally a path to also write the STL to, as the app's *Download STL* (T8), with the server's atomic write and its refusal to replace a file that isn't the project's own.

  It answers with the model's size, its height range and the detail (ground metres and mm per cell), as the app's dialog shows them. Areas too large or beyond the STL limits are refused with the app's messages (T6).
- **Same code as the app.** The ring goes through `planTerrain`, `loadTerrainTiles` and `terrainMesh`, then into the project through the workspace's model actions inside `change()` (ADR-0067), so the automatic version is kept. The tile fetch the worker does now (the URL from `lib/terrain-services`, a 404 meaning "no data at this zoom", any other failure meaning `workspace.terrainUnavailable`) moves into one shared function that takes the WebP decoder as an argument: `createImageBitmap` in the worker, the server's decoder in Node.
- **WebP in Node.** `@jsquash/webp` (Apache-2.0), libwebp compiled to WebAssembly, decodes the tiles to RGBA, which `decodeTerrarium` reads as today. Like `occt-import-js` (ADR-0072), it stays a dependency of `@furrow/mcp` rather than being bundled, so its WebAssembly file is read from `node_modules`, and it is loaded only when the tool runs. A native decoder (`sharp`) was set aside: platform binaries in an `npx` package for one feature.
- **Network.** The server makes `GET` requests to Mapterhorn's tile host, the one in `lib/terrain-services`, only while `import_terrain` runs, and only for the tiles of the area. It contacts no other host: no base map (the assistant doesn't need one) and no place search (option 3). Offline or with Mapterhorn down, the tool fails with the app's message and nothing else changes. Every other tool stays offline, and there is still no telemetry (ADR-0067).
- **Privacy.** Mapterhorn receives the user's IP address and the area's tiles, as from the app (ADR-0076); the tool's description says so, so the assistant and the user see it before calling it. The privacy policy's section on these services gains the MCP server. The automatic version, the model and its name are the only things stored; the area and settings are not (ADR-0077).
- **Attribution.** The tool's answer credits Mapterhorn and its sources, as the app's map does.

## Consequences

- An assistant can go from a place's coordinates or link to a relief, roughing, finishing and G-code without the user opening the app; the model is byte-identical to the app's for the same area and settings.
- ADR-0067's "makes no network requests" becomes "makes no network requests except elevation tiles while `import_terrain` runs"; PRD-0012 and PRD-0014 say the same.
- `@furrow/mcp` gains a second unbundled dependency, a WebAssembly decoder loaded only by this tool.
- The tile fetch is shared by the worker and the server, so a change to the service, or to how missing tiles are handled, reaches both.
- If assistants turn out to need names after all, option 3 stays open, at the cost of a second third party in the privacy policy.
