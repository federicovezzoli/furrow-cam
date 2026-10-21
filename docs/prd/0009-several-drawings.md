# PRD-0009: Several drawings, arranged on the stock

- **Status:** Draft
- **Author:** Federico Vezzoli
- **Created:** 2026-10-21
- **Related:** PRD-0001, PRD-0002, PRD-0005, ADR-0022, ADR-0031, ADR-0038, ADR-0055

## Problem

A project holds one imported file: an SVG or DXF drawing, or an STL model (ADR-0022, ADR-0031). Real jobs are made of several parts, such as a sign's outline, its lettering and a carved emblem, often drawn in separate files. Users have to merge them in a drawing program before they import, which also fixes where each part sits on the stock. An imported drawing's size comes from the file (its units, or the DPI of an SVG), while a model can be resized and fitted to the stock.

## Users

- Hobbyists who combine parts from different files (downloaded designs, their own drawings) in one job.
- Small shops that nest several parts on one sheet, or repeat a part.

## Goals

- A user can build a job from several SVG, DXF and STL files in one project, without a drawing program.
- A drawing can be resized like a model, keeping its proportions.
- Later: drawings can be moved, mirrored, rotated and duplicated on the stock.

## Non-goals

- Editing paths or nodes, boolean operations, or drawing new shapes.
- Stretching a drawing in one direction only.
- Automatic nesting of parts on the stock.
- Selecting several drawings at once, or grouping them.

## Requirements

| ID | Requirement | Priority |
| --- | --- | --- |
| D1 | Import several SVG and DXF files into one project, and STL models alongside them. Each imported drawing is aligned to the stock at the XY zero's anchor, like the first (ADR-0022) | Must |
| D2 | Each imported drawing is one item, named after its file. Clicking one of its shapes in the viewport, when not picking an operation's targets, selects it and shows its properties over the viewport, as a model's are | Must |
| D3 | Set a drawing's width or height in the current units: it keeps its proportions, and its point at the zero's anchor stays put. *Fit to stock* fits it inside the stock less a border the user sets (10 mm by default), as for models (PRD-0005 S2) | Must |
| D4 | Remove a drawing, with the operations that only machine it, in one undo step | Must |
| D5 | Move a drawing: X and Y fields for its anchor point's distance from the zero, and dragging it in the viewport | Should |
| D6 | Mirror a drawing horizontally or vertically | Should |
| D7 | Rotate a drawing by 90° steps and by any angle | Should |
| D8 | Duplicate a drawing, placing the copy next to the original | Should |
| D9 | Move, rotate (90° steps about Z) and duplicate models with the same controls | Could |

## User flow

1. In a new project, the user imports `outline.svg`. It is aligned to the stock at the zero's anchor.
2. They import `lettering.svg`. It lands at the same anchor, on top of the outline.
3. They click the lettering, set its width to 180 mm, and (with D5) move it to the centre of the outline.
4. They import `emblem.stl` and place it as in PRD-0005.
5. They add a V-carve on the lettering, a 3D finishing on the emblem and a profile cut-out on the outline, and export the G-code.

## Success criteria

- A user cuts a sign made of an outline, lettering and an emblem from three files, with no drawing program in between and no manual G-code edits.

## Open questions

- Where should a duplicate land: offset by a fixed distance, or next to the original's bounding box?
- Should the drawings be listed somewhere (to select a hidden or overlapped one), or is clicking in the viewport enough?

## Changelog

- 2026-10-21: initial draft (ADR-0055)
