---
"@furrow/web": minor
"@furrow/cam-core": minor
---

Add the workspace viewport (ADR-0008): a three.js canvas, loaded only in the browser, showing the stock, a millimetre grid under it, the work origin and the imported geometry as lines, with selected and hovered shapes highlighted from the workspace store. All shapes are drawn in one call, with the selection and hover drawn over them. A toolbar switches between an orthographic top view (pan with the right or middle button, zoom to the cursor with the wheel) and a perspective orbit view, and fits the camera to the stock; each view keeps its camera when you switch away and back, and resizing the stock fits it again. Geometry is stored and drawn in stock coordinates, from the stock's bottom-left corner (ADR-0014), so changing the work origin moves only the origin marker and the grid, never the design. `@furrow/cam-core` gains `flattenPath`, which turns arcs and cubic Béziers into polylines within a chord tolerance (0.01 mm by default) and ends closed paths exactly on their start, and `stockOffset`, `stockBox` and `stockBounds`, which convert between stock and work coordinates.
