import { MAX_TERRAIN_SPAN, planTerrain } from "@furrow/cam-core";
import { describe, expect, it } from "vitest";
import { squareRing } from "./terrain-square";

describe("squareRing", () => {
  it("gives an area as wide as it is deep on the ground, whatever the drag", () => {
    // A drag 4 km east and 1 km south, at the latitude of Lecco.
    const ring = squareRing([9.39, 45.92], [9.39 + 4000 / 77_400, 45.92 - 1000 / 111_195]);
    const { span } = planTerrain(ring, { maxBytes: 1e6, maxTriangles: 1e4 }, 14);
    expect(span[0]).toBeCloseTo(span[1], 0);
    expect(span[0]).toBeGreaterThan(3900);
    expect(span[0]).toBeLessThan(MAX_TERRAIN_SPAN);
    // It went south of where the drag started.
    expect(ring[2]?.[1]).toBeLessThan(45.92);
  });

  it("stops at the map's edges instead of going past them", () => {
    const east = squareRing([179.9, 10], [181, 10.5]);
    expect(Math.max(...east.map(([lon]) => lon))).toBe(180);
    const north = squareRing([20, 84.9], [20.1, 86]);
    expect(Math.max(...north.map(([, lat]) => lat))).toBe(85);
  });
});
