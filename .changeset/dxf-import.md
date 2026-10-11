---
"@furrow/cam-core": minor
"@furrow/web": minor
---

Import DXF files into the project geometry: lines, arcs, circles, polylines with bulges (old and lightweight), ellipses, splines, points and block references (with scale, rotation and arrays), keeping layer names and the drawing's coordinates, so DXF (0, 0) is the stock's bottom-left corner. `$INSUNITS` sets the units, and the user picks millimetres or inches on import when the file has none. Open entities on a layer whose ends meet are joined into one path, closed when it loops back, so outlines exported as separate lines and arcs can be profiled and pocketed. Circles and arcs stay arcs; ellipses and splines become cubics, exactly for splines up to degree 3 and within 0.001 mm otherwise. Entities with extrusion −Z are mirrored as DXF specifies; tilted ones, text, dimensions, hatches, solids, paper space and layers that are off or frozen are skipped with a warning, and binary DXF is refused. Files before AutoCAD 2007 are decoded with their code page. `@furrow/cam-core` adds `parseDxf`, `importDxf`, `dxfNeedsUnits`, `dxfUnitScale` and `DxfImportError`.
