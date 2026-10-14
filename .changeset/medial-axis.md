---
"@furrow/cam-core": minor
---

Add `medialAxis` (ADR-0025): the medial axis of an area as branches of points with the distance to the nearest edge at each, for V-carving. It samples the boundary every 0.2 mm by default and builds the axis from the Voronoi vertices of the samples (Delaunator), reaching into sharp convex corners at radius 0 and dropping the spurs that flattened curves would otherwise grow.
