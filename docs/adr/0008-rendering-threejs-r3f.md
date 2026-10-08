# ADR-0008: Rendering with three.js via React Three Fiber

- **Status:** Accepted
- **Date:** 2026-10-08
- **Deciders:** Federico Vezzoli
- **Related:** PRD-0001 (R9, R10), ADR-0002, ADR-0007

## Context

The workspace must display:

- **Imported geometry and the stock** in a top-down 2D view, with pan, zoom and selection of shapes.
- **Toolpaths**, distinguishing rapids from cutting moves, potentially tens or hundreds of thousands of segments for pockets.
- **A 3D view** of stock and toolpaths, and later a material-removal simulation (R10).

The UI is React (Next.js, ADR-0002).

## Options considered

1. **SVG DOM**: crisp, easy styling and hit-testing. Slows down badly with large toolpaths; 2D only.
2. **Canvas 2D**: decent performance, simple API. 2D only, so a second renderer would be needed for the 3D view and simulation.
3. **PixiJS (WebGL 2D)**: fast 2D, but still 2D only.
4. **three.js via React Three Fiber (r3f)**: WebGL handles large line counts well. One scene serves both the 2D top view (orthographic camera) and the 3D view (perspective camera). Integrates with React state. Cons: WebGL lines are 1px wide unless using "fat line" helpers, and text and dimension overlays need extra work.

## Decision

- Render the workspace with **three.js** through **React Three Fiber** (plus `@react-three/drei` helpers where useful).
- One scene, two camera modes: **orthographic top view** for setup and editing, **perspective orbit view** for 3D preview.
- Toolpaths are rendered as **`BufferGeometry` line segments** built in the Web Worker that generates them and transferred as typed arrays, with no per-segment objects.
- **Selection and snapping use our own geometry data** (point-to-path distance with a spatial index in the `geometry` module), not WebGL raycasting. This keeps picking precise and independent of the renderer.
- Overlays that are mostly text (dimensions, labels, tooltips) use HTML positioned over the canvas.
- The material-removal simulation (R10) will use the same scene; its algorithm (e.g. heightmap) gets its own ADR.

## Consequences

- One rendering stack for 2D editing, 3D preview and future simulation.
- Good performance headroom for large toolpaths.
- three.js and r3f become core dependencies; the workspace must be a client-only component (`dynamic(..., { ssr: false })`).
- Line width and text rendering need extra care compared to SVG/Canvas.
- Picking logic lives in the CAM core and is testable without a browser.
