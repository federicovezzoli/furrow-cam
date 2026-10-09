import type { Box3 } from "@furrow/cam-core";
import type { Shape } from "@furrow/document";
import { describe, expect, it } from "vitest";
import {
  boxCenter,
  fitOrbitPosition,
  fitTopZoom,
  gridLinePositions,
  POINT_MARKER_SIZE,
  shapeLinePositions,
} from "./viewport-scene";

const shape = (paths: Shape["paths"]): Shape => ({
  id: "4f8a1c2e-6b3d-4e5f-9a7b-8c9d0e1f2a3b",
  name: "",
  layer: "0",
  paths,
});

const stock: Box3 = { min: [0, 0, -18], max: [600, 400, 0] };

describe("shapeLinePositions", () => {
  it("draws each polyline edge as a segment, moved into work coordinates", () => {
    const positions = shapeLinePositions(
      shape([
        {
          start: [0, 0],
          segments: [
            { kind: "line", to: [10, 0] },
            { kind: "line", to: [10, 10] },
          ],
          closed: true,
        },
      ]),
      [-5, -5, 2],
    );
    // biome-ignore format: one segment per row
    expect([...positions]).toEqual([
      -5, -5, 2, 5, -5, 2,
      5, -5, 2, 5, 5, 2,
      5, 5, 2, -5, -5, 2,
    ]);
  });

  it("draws a single point as a cross", () => {
    const positions = shapeLinePositions(
      shape([{ start: [1, 2], segments: [], closed: false }]),
      [0, 0, 0],
    );
    const s = POINT_MARKER_SIZE;
    expect([...positions]).toEqual([1 - s, 2, 0, 1 + s, 2, 0, 1, 2 - s, 0, 1, 2 + s, 0]);
  });
});

describe("gridLinePositions", () => {
  it("covers the stock plus the margin, under it and aligned to the origin", () => {
    const { minor, major } = gridLinePositions(
      { min: [-15, -5, -18], max: [15, 5, 0] },
      { spacing: 10, majorEvery: 2, margin: 0 },
    );
    const lines = (positions: Float32Array) =>
      Array.from({ length: positions.length / 6 }, (_, i) => [
        ...positions.slice(i * 6, i * 6 + 6),
      ]);
    // Lines at x = -20…20 and y = -10…10; every second one (multiples of 20) is major.
    expect(lines(major)).toEqual([
      [-20, -10, -18, -20, 10, -18],
      [0, -10, -18, 0, 10, -18],
      [20, -10, -18, 20, 10, -18],
      [-20, 0, -18, 20, 0, -18],
    ]);
    expect(lines(minor)).toEqual([
      [-10, -10, -18, -10, 10, -18],
      [10, -10, -18, 10, 10, -18],
      [-20, -10, -18, 20, -10, -18],
      [-20, 10, -18, 20, 10, -18],
    ]);
  });
});

describe("camera fitting", () => {
  it("zooms the top view to the stock's limiting side", () => {
    expect(fitTopZoom(stock, { width: 1150, height: 1150 })).toBeCloseTo(1150 / (600 * 1.15));
    expect(fitTopZoom(stock, { width: 2000, height: 460 })).toBeCloseTo(1);
  });

  it("falls back to a zoom of 1 before the canvas has a size", () => {
    expect(fitTopZoom(stock, { width: 0, height: 0 })).toBe(1);
  });

  it("places the orbit camera in front of, right of and above the stock, far enough to see it", () => {
    const [x, y, z] = fitOrbitPosition(stock, 50, 1.5);
    const [cx, cy, cz] = boxCenter(stock);
    expect(x).toBeGreaterThan(cx);
    expect(y).toBeLessThan(cy);
    expect(z).toBeGreaterThan(cz);
    const radius = Math.hypot(600, 400, 18) / 2;
    expect(Math.hypot(x - cx, y - cy, z - cz)).toBeGreaterThan(
      radius / Math.sin((25 * Math.PI) / 180),
    );
  });
});
