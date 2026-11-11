# PRD-0015: Relief from an image

- **Status:** Draft
- **Author:** Federico Vezzoli
- **Created:** 2026-11-11
- **Related:** PRD-0005, PRD-0012, PRD-0014, ADR-0004, ADR-0029, ADR-0030, ADR-0077, ADR-0078

## Problem

Depth maps, embossed logos and lithophanes start as a greyscale image, not as a 3D model. Today users turn the image into an STL in another tool, then import it. Furrow CAM already builds a relief from a grid of heights for terrain (PRD-0014); an image is the same grid, read from pixels instead of elevation tiles.

## Users

- Hobbyists who carve a logo, a portrait or an AI-made depth map in relief.
- Makers who cut lithophanes: a photo carved from the back of thin, translucent stock with *Invert*.

## Goals

- A user goes from an image file to a relief model in the project in a few clicks, offline.
- The model machines like any imported STL (PRD-0005).

## Non-goals

- Light-box features for lithophanes (frames, curved panels, a thickness map tuned to light).
- Colour: only brightness counts.
- Keeping the image or the settings in the document to change them later.

## Requirements

| ID | Requirement | Priority |
| --- | --- | --- |
| I1 | **Relief from image** opens beside *Terrain from a map* (PRD-0014 T1) and picks a PNG, JPEG or WebP image | Must |
| I2 | **Settings:** the model's width in mm (the depth follows the image's aspect ratio; by default and at most, as wide as fits inside the stock less the model border, PRD-0005 S2), relief height (5 mm by default), base under black (3 mm by default), *Invert* (dark is high) and smoothing, a box blur of 0 to 50 image pixels (0 by default) against pixel noise. A 3D preview follows the settings, with the image's pixels and the model's size | Must |
| I3 | **Heights:** each pixel's luminance (Rec. 709 on its sRGB values), transparent counting as black before *Invert*, so a PNG logo stands on its base. The model is always the image's full rectangle | Must |
| I4 | **Detail:** the grid is the largest that fits the instance's STL limits (PRD-0005 S1) and has no more corners than the image has pixels. A larger image is read once, when it is picked, at two pixels a cell (its pixels averaged), then smoothed over a cell so the corners don't alias; the smoothing setting stays in the picked image's pixels. An image file larger than the STL byte limit is refused | Must |
| I5 | **Generate:** as terrain (PRD-0014 T5, T6, T8): in a project with no model yet, the relief becomes its model at the chosen size, centred on the stock and named after the image; it can be cancelled, or downloaded as an STL | Must |
| I6 | **From an assistant:** the MCP server (PRD-0012) adds the relief of an image file to a project with the I2 settings and the same defaults. Its decoders ignore EXIF orientation and colour profiles, so a photo stored on its side must be turned first | Should |

## Decision record

ADR-0077's decision covers this feature: the relief is a closed STL generated in the mesh worker and imported like any model, and nothing else is stored. The grid-to-mesh step (top, walls, bottom, triangle budget) is shared by terrain and images (`cam-core/src/import/height-grid.ts`). The MCP server decodes PNG and JPEG with the same kind of WebAssembly decoder it already uses for WebP tiles, since Node has no `createImageBitmap`.

## Success criteria

- A user carves a 150 mm relief of a logo from a PNG, with no other tool.
