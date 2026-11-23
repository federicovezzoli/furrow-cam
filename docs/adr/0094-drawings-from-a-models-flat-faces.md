# ADR-0094: Drawings from a model's flat faces; STEP models keep their faces

- **Status:** Accepted
- **Date:** 2026-11-23
- **Deciders:** Federico Vezzoli
- **Related:** PRD-0005 (S14), ADR-0004, ADR-0029, ADR-0055, ADR-0067, ADR-0072, ADR-0078; issue #665. Supersedes in part ADR-0072 (the STEP file's faces are no longer lost on import).

## Context

A model is machined only with relief roughing and finishing (PRD-0005). Many parts drawn in a solid modeller are 2.5D: flat floors at a few depths, vertical walls, through holes. Z-level roughing plus raster finishing is slow on them and leaves scallops on the floors; a pocket per floor, a profile around the part and drill operations for the holes are faster and cleaner, but the user had to redraw the part as SVG or DXF. PRD-0005 also left open whether a model should offer its outline for a profile cut-out. ADR-0072 set aside "turning STEP faces into 2D drawings" as a different feature.

## Options considered

1. **Pick a face in the viewport** and turn it into a drawing. Pros: exact control. Cons: raycasting on the mesh, which the viewport doesn't do (picking is our own 2D geometry, ADR-0008), and one click per level.
2. **One command for every flat level and the outline.** Pros: no new viewport interaction; a 2.5D part's whole set of outlines in one step. Cons: levels the user doesn't need come too, for them to ignore or delete.
3. **Also create the operations** (a pocket per level, a profile on the outline, drills on the holes). Pros: fewest clicks. Cons: tools, depths and order are the user's choices; guessing them hides decisions.

For a STEP file, the faces could be rebuilt from coplanar triangles as for an STL, or kept from OpenCascade, which reports which triangles each face of the solid was meshed into.

## Decision

Option 2, drawings only:

- **Drawings from model**, in the model's panel and as the MCP tool `drawings_from_model`, adds one drawing, as one undo step, where the model lies. It is named after the model's file and not tied to it: moving or turning the model later leaves it where it was, and the user makes it again.
- **Levels:** the flat, upward-facing faces, merged by height, from the top down. Each is one shape on a layer named after its height below the stock top in the project's units (`Z -6 mm`). No operation is created and no depth is filled in.
- **Outline:** the outer boundary of every upward-facing triangle seen from above, without holes, one shape on a layer named in the interface language (*Outline*).
- **Holes:** a ring a circle fits, as drilling decides (`isRound`), becomes a full-circle arc through its vertices.
- **How:** `modelFlatFaces` in `@furrow/cam-core` (`scene/flat-faces.ts`), run in the mesh worker (ADR-0004). Each level's triangles are united with Clipper2, which gives outer rings and holes whatever the mesh's T-junctions. Heights agree within 0.005 mm; levels under 1 mm² are dropped, as the near-flat facets at the top of a curved STL surface would be.
- **STEP faces:** the import keeps, as the model's optional `faces`, how many of the STL's triangles each face of the solid was meshed into, in the STL's order (`brep_faces` from `occt-import-js`). A face then counts as flat only if all of it is. The document schema goes to version 44; the field is absent for STL files and older models, which use the triangles one by one. OpenCascade doesn't say which faces are cylinders, so holes are still fitted, on vertices that lie on the true circle within the 0.05 mm tolerance.
- Faces that are not horizontal are ignored; a two-sided project's bottom faces are not drawn.

## Consequences

- A 2.5D part imported as STL or STEP is machined with 2D operations without redrawing it, and a relief gets its outline for a profile cut-out (PRD-0005's open question).
- The STEP file's faces now reach the document, which ADR-0072 said were lost; the exact solid still is.
- Documents with `faces` don't open in releases before schema version 44.
- An STL's flat levels depend on its mesher: a level split by a tiny step in height comes out as two.
- Picking a single face, and drawing faces that aren't horizontal, stay open.
