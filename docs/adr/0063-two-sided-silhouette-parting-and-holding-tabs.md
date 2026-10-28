# ADR-0063: Each side cuts all of the model it can see, and two-sided holding tabs are a setting of the setup

- **Status:** Proposed
- **Date:** 2026-10-28
- **Deciders:** Federico Vezzoli
- **Related:** PRD-0011 (B2, B5), ADR-0030, ADR-0033, ADR-0038, ADR-0060; #357. Supersedes in part ADR-0060: the parting plane no longer limits the cut inside the model's outline.

## Context

ADR-0060 parts the two sides at one flat plane, `partingDepth` below the stock top. Each side's 3D operations cut nothing past it (`reliefFloor`). That causes two problems:

- A model that isn't widest at the plane, such as a mushroom cap or a cone standing on its base, keeps a skirt of material between its widest part and the plane: the side below can't cut past the plane to reach the underside.
- Neither side can reach a cavity seen from the top that goes below the plane, such as the inside of a cup.

The two sides also meet at that plane all round the model, so the part comes loose while the bottom side is cut (PRD-0011 B5). It must stay held to the surrounding stock until the last pass. Profile tabs (#22) solve this for 2D profiles, but they belong to one operation, and a 3D part is cut by several operations on the bottom side.

## Options considered

1. **Keep the flat plane.** Pros: already built. Cons: the skirt and the unreachable cavities above.
2. **Parting follows the silhouette:** inside the model's outline, as each side sees it, that side cuts all of the model it can see; the plane only limits the cut around the model. Pros: no skirt, and cavities are reached from the side they open to. The upper and lower surfaces of the model never cross, so the two sides don't cut the same material twice. Cons: the parting depth no longer marks where the model is split, only where the material around it is.
3. **Tabs as a parameter of each bottom-side operation**, like profile tabs. Pros: follows profiles. Cons: a finishing pass without tabs cuts away what the roughing left.
4. **Tabs as a setting of the two-sided setup** that every bottom-side 3D operation leaves. Pros: no pass can cut them by accident; one place to set them, like the pins. Cons: a bottom-side operation can't opt out.
5. **Tabs as their own operation.** Cons: a tab is material that is *not* cut, so there is nothing for the operation to do.

## Decision

Options 2 and 4:

- **Silhouette parting:** a two-sided project's 3D roughing, rest roughing and finishing cut, on either side, down to the model's surface as seen from that side. Over the model they have no floor at the parting plane. With its centre outside the model, or over its holes, the tool goes no lower than the parting plane: the top side cuts down to it and the bottom side up to it, which frees the part. A tool centred over the model may still reach past the model's outline, so it cuts the underside of an overhang out to its edge. `partingDepth` keeps its meaning and default from ADR-0060.
- **Tabs** (`TwoSided.tabs` in `@furrow/document`): `null` for none, else `{ width, thickness, positions }`. `positions` are points in the top side's stock coordinates, each moved to the nearest point of a model's outline: its box seen from above, as the roughing's `model` boundary (ADR-0038) uses it. Each tab is a strip `width` wide along the outline's outward normal, from the middle of the model's box out to the stock's edge, and `thickness` thick just below the parting plane on the bottom side. Every bottom-side 3D operation cuts nothing inside a tab, which holds the model wherever its surface is lower than the tab's top. The top side ignores tabs: the part is still whole while the top is cut.
- **Placement:** *Auto place* spreads a number of tabs evenly around the model's outline (`autoTabPositions`), and tabs are dragged along it, as for profile tabs.
- **Warnings:** a two-sided project's bottom-side 3D operation without tabs, since the part comes loose; and a 3D roughing with the `stock` boundary (ADR-0038) in a two-sided project, since it leaves no frame for the tabs to hold on to.

## Consequences

- `reliefFloor` no longer clamps at the parting plane. Cells of the model heightmap that no part of the model is over hold no material; a tool centred over one stops at the plane instead, and roughing adds a level at the plane so the area around the model is cleared flat.
- The tabs are flat-topped obstacles the bottom side's tools ride over, as the touch-off pad is (ADR-0041), and islands in pocket roughing below their top. The simulation shows them because the toolpaths leave them.
- A model whose surface reaches past the parting plane at its outline, seen from the top side, may have the top side's tool reach into a tab's root there; the default parting depth, half the model's depth, keeps such models rare.
- The user cuts the tabs by hand once the bottom side is done, as with profile tabs.
- 2D operations on the bottom side (#360) don't leave two-sided tabs; a profile there keeps its own tabs.
