---
"@furrow/document": minor
"@furrow/cam-core": minor
"@furrow/web": minor
---

Zero point model (ADR-0016). The stock's `xyOrigin` is now `{ anchor }`, with one of 9 stock anchors (`StockAnchor`: corners, edge midpoints and centre), or `{ anchor: "custom", x, y }` in millimetres from the stock's bottom-left corner, which may lie outside the stock. Documents with the old `"bottom_left"` and `"center"` strings still load and are normalised. `stockOffset` and `stockBounds` handle every anchor and custom zeros, anchors following the stock when it is resized; `@furrow/cam-core` adds `xyOriginPosition`, and `stockBox` needs only the stock's size. The viewport's origin marker follows the zero; the grid reaches it when it lies outside the stock (getting coarser past 1000 lines per axis), and Fit frames it too.
