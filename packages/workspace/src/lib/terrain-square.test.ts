import { MAX_TERRAIN_SPAN, planTerrain } from "@furrow/cam-core";
import { describe, expect, it } from "vitest";
import { moveRing, squareRing } from "./terrain-square";

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

describe("moveRing", () => {
  it("keeps a square square on the ground when it is moved far north", () => {
    const square = squareRing([9.39, 45.92], [9.39 + 5000 / 77_400, 45.92 + 5000 / 111_195]);
    const north = moveRing(square, [9.4, 45.9], [9.4, 60.9]);
    const limits = { maxBytes: 1e6, maxTriangles: 1e4 };
    const before = planTerrain(square, limits, 14).span;
    const after = planTerrain(north, limits, 14).span;
    expect(after[0]).toBeCloseTo(before[0], -1);
    expect(after[1]).toBeCloseTo(before[1], -1);
    expect(Math.min(...north.map(([, lat]) => lat))).toBeGreaterThan(60);
  });

  it("stops at the map's edges when dragged past them", () => {
    const square = squareRing([170, 80], [171, 81]);
    const moved = moveRing(square, [170, 80], [185, 88]);
    expect(Math.max(...moved.map(([lon]) => lon))).toBe(180);
    expect(Math.max(...moved.map(([, lat]) => lat))).toBe(85);
  });
});
