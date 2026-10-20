# PRD-0005: STL relief machining

- **Status:** Draft
- **Author:** Federico Vezzoli
- **Created:** 2026-10-15
- **Related:** PRD-0001, PRD-0003, ADR-0003, ADR-0004, ADR-0016, ADR-0019, ADR-0029, ADR-0030

## Problem

Furrow CAM only machines 2D drawings (PRD-0001), which lists "3D surfacing / freeform models (STL, STEP)" as a non-goal. Hobby router owners also carve 3D reliefs: signs with raised lettering, topographic maps, bas-reliefs and decorative panels. These are usually downloaded or exported as STL meshes and cut from the top on a 3-axis machine. Today they need a second, often paid or desktop-only CAM for that, while the 2D parts of the same project stay in Furrow CAM.

## Users

- Hobbyists who carve reliefs from STL files they download or model (signs, maps, panels).
- Small shops that combine a relief with 2D cuts (a sign with a carved emblem and a profile cut-out).

## Goals

- A user can go from an STL relief to roughing and finishing G-code in a few minutes, in the same project and with the same tools and machines as their 2D work.
- Toolpaths for a typical relief compute in the browser fast enough to stay interactive (ADR-0030).
- Several operations, each with its own tool, can machine the same model.

## Non-goals

- Undercuts, overhangs, 4th axis, flipping the stock to machine both sides.
- STEP, OBJ, 3MF or other mesh and solid formats.
- Editing the mesh (sculpting, repairing, boolean operations).
- Converting images or 2D drawings into reliefs (heightmap from a picture).
- A per-user storage quota under the freemium limits (PRD-0003); only the per-file limits below apply for now.

## Requirements

| ID | Requirement | Priority |
| --- | --- | --- |
| S1 | Import STL files, binary and ASCII, into a project. Files above **50 MB** or **2,000,000 triangles** are refused with a clear message; the operator can change both limits | Must |
| S2 | Place the model on the stock: rotate it in 90° steps about each axis, scale it uniformly or fit it inside the stock less a border the user sets (10 mm by default, 0 for edge to edge), and set its depth into the stock (its top at the stock top). It is positioned relative to the zero point (ADR-0016) like the 2D drawing | Must |
| S3 | The model is machined from the top only. The UI says that undercuts and overhangs are filled in, and shows the model as it will be cut | Must |
| S4 | **3D finishing:** parallel (raster) passes over the model with angle, stepover, cut direction (one-way or zig-zag) and stock to leave. Works with every tool shape; ball end mills are the usual choice | Must |
| S5 | **3D roughing:** clears the material above the model in Z levels with the existing pocket clearing (PRD-0001 R20), leaving a set amount of stock for finishing. It clears the model's outline, the outline and a margin around it (leaving the stock top beyond it uncut, to zero Z on after a tool change), or the whole stock | Must |
| S6 | Toolpaths, the simulation (PRD-0001 R10) and G-code export work for 3D operations as for 2D ones, and a project can mix both | Must |
| S7 | Meshes are stored with the project, kept by its saved versions, and deleted with it. A project with meshes exports as one `.zip` file (document and meshes) and imports back from it; projects without meshes still export as `.furrow.json` | Must |
| S8 | **Rest machining:** an operation can start from the stock left by the operations before it, so a smaller tool only cuts where material remains | Should |
| S9 | Corner clean-up of the model's concave edges with a small tool | Could |
| S10 | Other finishing patterns: waterline (constant Z) and spiral | Should |
| S11 | Rest machining for 2D pockets, reusing S8 | Could |
| S12 | 3D operations leave the touch-off pad, once the user turns it on, at the stock top (PRD-0002 Z11), so Z can be zeroed on it after the tool change between roughing and finishing | Should |

## User flow

1. In a project, the user imports `emblem.stl`. It appears on the stock, scaled to fit inside a 10 mm border, its top at the stock top.
2. They rotate it so the right face is up, set its width to 200 mm and its depth to 12 mm, and move the zero point.
3. They tick **Touch-off pad** in the zero section, which puts a pad on the XY zero, move it where the relief leaves stock top, then add a 3D roughing operation with a 6 mm flat end mill, leaving 0.5 mm of stock, and a 3D finishing operation with a 3 mm ball end mill at a 10% stepover. The pad stays uncut, and at the tool change the machine stops over it to zero Z.
4. They check the toolpaths and the simulation, then export the G-code.

## Success criteria

- A user carves a 200 × 150 mm relief from a downloaded STL on a GRBL machine with roughing and finishing passes, with no manual G-code edits.
- Finishing a 300 × 200 mm relief with a 3 mm ball end mill computes in under 10 s in the browser on a recent laptop.

## Open questions

- Should a model also offer a 2D outline (its silhouette) for a profile cut-out, or is that drawn separately?

## Changelog

- 2026-10-15: initial draft (#101)
- 2026-10-17: S2 fits models inside a border, S5 clears a margin around the model (#146, ADR-0038)
- 2026-10-17: S10 (waterline and spiral finishing) moves up to Should and is built (#130, ADR-0039)
- 2026-10-17: S12, the touch-off pad (#147, ADR-0041)
- 2026-10-17: S12 and the user flow: the touch-off pad is turned on by the user, not added on import (#178, ADR-0043)
- 2026-10-19: S2's border is set by the user per model (#183, ADR-0038)
