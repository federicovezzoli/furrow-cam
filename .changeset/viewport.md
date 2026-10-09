---
"@furrow/web": minor
"@furrow/cam-core": minor
---

Add the workspace viewport (ADR-0008): a three.js canvas, loaded only in the browser, showing the stock, a millimetre grid under it, the work origin and the imported geometry as lines, with selected and hovered shapes highlighted from the workspace store. A toolbar switches between an orthographic top view (pan with the right or middle button, zoom to the cursor with the wheel) and a perspective orbit view, and fits the camera to the stock. Geometry is drawn in stock coordinates, from the stock's bottom-left corner, so the work origin doesn't move the design on the stock. `@furrow/cam-core` gains `flattenPath`, which turns arcs and cubic Béziers into polylines within a chord tolerance (0.01 mm by default), and `stockOffset`/`stockBounds`, which place the stock in work coordinates.
