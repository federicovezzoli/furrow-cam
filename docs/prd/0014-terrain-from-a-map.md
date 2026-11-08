# PRD-0014: Terrain from a map

- **Status:** Draft
- **Author:** Federico Vezzoli
- **Created:** 2026-11-08
- **Related:** PRD-0005, PRD-0007, PRD-0008, ADR-0013, ADR-0029, ADR-0030, ADR-0076, ADR-0077, ADR-0078

## Problem

Topographic reliefs (a mountain, a valley, an island) are among the most popular things to carve on a hobby router, and Furrow CAM already machines reliefs from STL files (PRD-0005). But the STL has to come from somewhere else: users open a separate website or tool, find the place, select an area, export a mesh, then import it. Those tools often need an account or a commercial map API key, cap the area or the resolution, or are closed source. Furrow CAM is open source and needs no account to try (PRD-0008), so this step should be part of it, built on open data and services that need no key.

## Users

- Hobbyists who carve topographic reliefs as gifts or decoration: a mountain they climbed, the valley they live in, a lake with its shores.
- Small shops that sell custom terrain panels and want to go from a place name to G-code in one tool.

## Goals

- A user goes from a place name to a relief model in the project in under a minute, without leaving Furrow CAM or creating any account or key.
- The model machines like any imported STL (PRD-0005), so roughing, finishing, rest machining and the simulation work unchanged.
- The feature works on the web, as a guest and in the desktop app, using only open data and services that need no key.

## Non-goals

- Satellite or aerial imagery, and textures or colours on the model.
- Roads, buildings, rivers or other map features as drawings or as part of the relief.
- Contour lines as 2D drawings (layered "stacked" topographic maps).
- Working offline: without a connection the feature says so, and the rest of the app is unaffected.
- Sea floor depths (bathymetry), and areas beyond 85° latitude or across the 180° meridian.
- Areas larger than 200 km across, where the Earth's curvature starts to matter.
- Hosting our own map, search or elevation servers (ADR-0076).
- Terrain from the MCP server (PRD-0012), which makes no network requests.

## Requirements

| ID | Requirement | Priority |
| --- | --- | --- |
| T1 | **Terrain from a map** opens beside model import, in two steps: first the area on a map the user can pan and zoom, with the attribution of its map and elevation data; then the model made from it | Must |
| T2 | **Find a place:** a search field suggests places as the user types, named in the interface language where the search service has it (English, German, French) and by their local names otherwise; picking one moves the map there. Entering coordinates or pasting a full Google Maps or OpenStreetMap link (with the coordinates in it) moves the map without sending anything to a search service. A short link (`maps.app.goo.gl`) carries no coordinates, so the dialog asks for the address shown in the browser bar after opening it. When the search service is unavailable, the dialog says so and points to coordinates and links | Must |
| T3 | **Select the area:** a rectangle, a square, a circle, an ellipse or a freehand shape, drawn on the map by dragging once its shape is picked (otherwise dragging moves the map), then moved by dragging it or redrawn before generating. The area's size on the ground (km) is shown | Must |
| T4 | **Settings:** in the second step, a 3D preview of the mesh, made again as the settings change, beside the model's longest side in mm (by default it fits inside the stock less the model border, PRD-0005 S2), vertical exaggeration (1× to 10×, 1.5× by default), and base thickness under the lowest point (3 mm by default). The dialog shows the resulting model size, height range and detail (ground distance and mm per cell). The mesh is made at full detail only when it is added or downloaded | Must |
| T5 | **Generate:** in a project with no model yet (it may hold drawings, ADR-0078), the terrain becomes a model, at the chosen size and centred on the stock, named after the place found (or "Terrain"). From then on it is an ordinary model: PRD-0005 S1 to S12 apply, it is stored, versioned, exported and imported with the project | Must |
| T6 | Generating shows its progress and can be cancelled. It refuses an area too large or one whose detail would exceed the instance's STL limits (PRD-0005 S1) with a clear message, by lowering the detail first where it can | Must |
| T7 | **Outline:** the shape's outline is added as a drawing at the model's position, so the piece can be cut out with a profile operation in the same project (ADR-0078) | Should |
| T8 | **Download STL:** the same mesh can be downloaded as a closed (watertight) binary STL, for 3D printing or another CAM | Should |
| T9 | The services are named by the map's attribution (OpenStreetMap, OpenFreeMap, Mapterhorn) and the privacy policy (Photon too), with no notice or click in the dialog; no account, sign-in or API key is needed, on any instance or in the desktop app | Must |
| T10 | **Lowest altitude:** set an altitude below which the terrain is flat, for lakes and coasts | Could |

## User flow

1. In a project, the user opens **Terrain from a map** next to the model import.
2. They type "Grignetta", pick *Grignetta, Lecco, Italia* from the suggestions, and the map moves there.
3. They choose **Ellipse** and drag an ellipse around the peak; the dialog shows 4.2 × 3.1 km. They click **Next**.
4. A 3D preview of the relief appears. They set the longest side to 200 mm and the exaggeration to 2×; the preview follows, and the dialog shows 200 × 148 × 31 mm, about 6 m per cell.
5. They click **Add to project**. After a few seconds the relief sits on the stock with its outline as a drawing.
6. They add 3D roughing, 3D finishing and a profile on the outline, check the simulation and export the G-code.

## Success criteria

- A user carves a 200 × 150 mm relief of a mountain they searched by name, on a GRBL machine, with no other tool and no manual G-code edits.
- Generating a 200 mm model of a 10 km area takes under 10 s on a typical broadband connection and a recent laptop.
- The same flow works as a guest on the web and in the desktop app.

## Open questions

- Should the outline drawing follow the model when the model is moved or scaled, or stay where it was added?
- If the public search service throttles us as usage grows, do we run our own instance (ADR-0076)?

## Changelog

- 2026-11-08: created
- 2026-11-08: two steps with a 3D preview, a square and a move tool; the services are named beside the map instead of before it loads (T1, T3, T4, T9, #522)
- 2026-11-08: the map is browsed until a shape is picked, the drawn area can be dragged, and no privacy line sits under the map (T1, T3, T9, #526)
