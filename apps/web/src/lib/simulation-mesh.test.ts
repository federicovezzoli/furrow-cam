import { MAX_HEIGHTMAP_CELLS } from "@furrow/cam-core";
import { describe, expect, it } from "vitest";
import {
  heightmapCellLimit,
  simulationTexture,
  skirtPositions,
  TEXTURE_WIDTH,
} from "./simulation-mesh";

describe("heightmapCellLimit", () => {
  it("fits the device's tallest texture, up to the cap", () => {
    expect(heightmapCellLimit(2048)).toBe(2048 * 2048);
    expect(heightmapCellLimit(3000)).toBe(2048 * 3000);
    expect(heightmapCellLimit(16384)).toBe(MAX_HEIGHTMAP_CELLS);
  });
});

describe("simulationTexture", () => {
  it("wraps the heights onto whole texture rows", () => {
    const heights = new Float32Array(TEXTURE_WIDTH + 1).fill(-2);
    const { data, height } = simulationTexture(heights);
    expect(height).toBe(2);
    expect(data).toHaveLength(TEXTURE_WIDTH * 2);
    expect(data[TEXTURE_WIDTH]).toBe(-2);
    expect(data[TEXTURE_WIDTH + 1]).toBe(0);
  });
});

describe("skirtPositions", () => {
  it("drops each edge of the surface to the stock bottom, out to the corners", () => {
    /** 3 × 2 cells of 2 mm; the middle bottom cell is cut 1 mm deep. */
    const heightmap = {
      columns: 3,
      rows: 2,
      cellWidth: 2,
      cellHeight: 2,
      heights: new Float32Array([0, -1, 0, 0, 0, 0]),
    };
    const positions = skirtPositions(heightmap, 5);
    /** Two triangles per pair of neighbouring edge cells: (2 + 2 + 1 + 1) pairs. */
    expect(positions).toHaveLength(6 * 2 * 9);
    /** The front edge, from the corner to the cut cell's centre. */
    expect([...positions.slice(0, 9)]).toEqual([0, 0, 0, 3, 0, -1, 3, 0, -5]);
    const xs = positions.filter((_, i) => i % 3 === 0);
    const ys = positions.filter((_, i) => i % 3 === 1);
    expect(Math.max(...xs)).toBe(6);
    expect(Math.max(...ys)).toBe(4);
    expect(Math.min(...positions.filter((_, i) => i % 3 === 2))).toBe(-5);
  });
});
