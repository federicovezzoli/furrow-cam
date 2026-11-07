# ADR-0072: STEP files are turned into STL on import, with OpenCascade in WebAssembly

- **Status:** Proposed
- **Date:** 2026-11-01
- **Deciders:** Federico Vezzoli
- **Related:** PRD-0005 (S1), PRD-0001, ADR-0004, ADR-0029, ADR-0044, ADR-0047, ADR-0067; issue #442

## Context

Solid modellers (Fusion, FreeCAD, Onshape, SolidWorks) export STEP. Users who designed a part there had to convert it to STL elsewhere before Furrow CAM could machine it as a relief (PRD-0005). STEP describes exact solids (boundary representation), not triangles: reading it takes a CAD kernel, and the only one that runs in a browser is OpenCascade compiled to WebAssembly. Everything downstream of import reads STL: the mesh and toolpath workers, the MCP server, project archives, and the stored asset, whose key is the SHA-256 of the STL bytes (ADR-0029).

## Options considered

1. **Turn the STEP file into STL on import** and store that: nothing downstream changes. The STEP file itself is not kept, so the model can't be tessellated again later at another tolerance.
2. **Store the STEP file** and tessellate it wherever a mesh is read: keeps the exact solid, but every reader (two workers, the MCP server, previews after reload) then needs the 7.6 MB kernel, and the asset no longer is what the readers parse.
3. **Turn STEP faces into 2D drawings** (outlines, pockets, holes): a different feature, deriving 2.5D operations from 3D geometry. Not this decision.

## Decision

We will use option 1:

- **Kernel:** [`occt-import-js`](https://github.com/kovacsv/occt-import-js) 0.0.23, OpenCascade's STEP reader and mesher built with emscripten. It outputs millimetres whatever the file's units.
- **Tolerance:** triangles stay within **0.05 mm** of the surface (absolute chord deflection) and 0.5 rad of each other, finer than a router cuts. A 2.7 m panel exported from Fusion becomes 179,000 triangles in about 3 seconds. 0.01 mm gave 700,000 triangles in 17 seconds without a difference a cutter could make.
- **Where it runs:** `stepToStl` in `@furrow/workspace/lib/step`, called by the mesh worker that already reads STL files on import (ADR-0004), which recognises a STEP file by its `ISO-10303-21` header. It writes a binary STL with `writeBinaryStl` from `@furrow/cam-core`, beside `parseStl`; the worker hashes and checks that like any STL, and sends it back to be stored in place of the file. The model keeps the STEP file's name; its size is the STL's.
- **Loading:** `occt-import-js` is the one third-party module a workspace worker may import besides the core packages: it has no DOM. Its JavaScript is a separate chunk imported, and its WebAssembly fetched, only when a STEP file is read, never on page load. The WebAssembly is bundled with the app (`new URL(…, import.meta.url)`), so the desktop app, which has no network (ADR-0047), works too; its CSP allows `'wasm-unsafe-eval'`. The bytes are handed to the module (`wasmBinary`), so it never loads files itself.
- **Limits:** PRD-0005 S1's file size limit applies to the STEP file. The STL made from it must stay within the triangle limit and, since it is stored, the file size limit too: it is refused with the triangle message otherwise.
- **MCP server (ADR-0067):** imports `.step` and `.stp` with the same function. `occt-import-js` stays out of its bundle and is a dependency of `@furrow/mcp`, read from `node_modules` at run time.
- **Licence:** `occt-import-js` and OpenCascade are LGPL-2.1. Furrow CAM, MIT, ships them unmodified as a separately loaded module, which the LGPL allows. Their licence texts ship beside the WebAssembly (`OCCT_LICENCES`, as the bundled fonts ship theirs).

## Consequences

- A STEP part machines like an STL relief, with nothing else changed: no schema change, no migration, and projects with a STEP model open in older versions of the app.
- The exact solid is lost on import: changing the tolerance later means importing the file again.
- The web app serves 7.6 MB of WebAssembly (3.1 MB compressed) to whoever imports a STEP file, once per import, since each import's worker goes away with it.
- The first STEP import needs a connection on the web; without one it says STEP import couldn't be loaded.
- Assemblies come in as one mesh, every body in its place.
- `occt-import-js` was last released in December 2024. It is a thin wrapper around OpenCascade, so it can be rebuilt from OpenCascade if it goes stale.
- Neither app has a third-party notices page yet; one should list OpenCascade with its licence and where its source is.
