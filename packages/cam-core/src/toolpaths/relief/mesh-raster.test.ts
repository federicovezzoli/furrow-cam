import { describe, expect, it } from "vitest";
import { modelHeightmap, rasterizeMesh } from "./mesh-raster";

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];

/** A 1 × 1 square at height `z`, as two triangles. */
function square(z: number, [x, y] = [0, 0], size = 1): number[] {
  const a = [x, y, z];
  const b = [x + size, y, z];
  const c = [x + size, y + size, z];
  const d = [x, y + size, z];
  return [...a, ...b, ...c, ...a, ...c, ...d];
}

describe("rasterizeMesh", () => {
  const grid = { columns: 4, rows: 4, cellWidth: 1, cellHeight: 1 };

  it("keeps the highest surface over each cell, leaving the rest at the base", () => {
    // An overhang at z = 3 over a floor at z = 1: from above, only the overhang shows.
    const mesh = new Float32Array([...square(1, [0, 0], 4), ...square(3, [1, 1], 2)]);
    const heights = rasterizeMesh(mesh, IDENTITY, grid, -5);
    expect(Array.from(heights)).toEqual([1, 1, 1, 1, 1, 3, 3, 1, 1, 3, 3, 1, 1, 1, 1, 1]);
    const small = rasterizeMesh(new Float32Array(square(2, [1, 1], 1)), IDENTITY, grid, -5);
    expect(Array.from(small)).toEqual([-5, -5, -5, -5, -5, 2, -5, -5, ...Array(8).fill(-5)]);
  });

  it("reads either winding and interpolates sloped triangles", () => {
    // A ramp rising along X from z = 0 to z = 4, wound clockwise.
    const ramp = new Float32Array([0, 0, 0, 4, 4, 4, 4, 0, 4, 0, 0, 0, 0, 4, 0, 4, 4, 4]);
    const heights = rasterizeMesh(ramp, IDENTITY, grid, -1);
    expect(Array.from(heights.subarray(0, 4))).toEqual([0.5, 1.5, 2.5, 3.5]);
  });

  it("skips triangles seen edge-on and applies the transform", () => {
    const wall = new Float32Array([1, 0, 0, 1, 4, 0, 1, 0, 4]);
    expect(rasterizeMesh(wall, IDENTITY, grid, -1).every((z) => z === -1)).toBe(true);
    // Scaled by 2 in X and Y and lowered by 3.
    const transform = [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1, -3];
    const heights = rasterizeMesh(new Float32Array(square(3)), transform, grid, -9);
    expect(Array.from(heights)).toEqual([0, 0, -9, -9, 0, 0, -9, -9, ...Array(8).fill(-9)]);
  });
});

describe("modelHeightmap", () => {
  it("covers the rotated outline with its top at zero and the rest at its bottom", () => {
    // A 2 × 1 floor at z = 0 with a 1 × 1 block on its left at z = 1.
    const mesh = new Float32Array([...square(0, [0, 0], 1), ...square(0, [1, 0], 1), ...square(1)]);
    const bounds = { min: [0, 0, 0], max: [2, 1, 1] } as const;
    const heightmap = modelHeightmap(mesh, { min: [0, 0, 0], max: [2, 1, 1] }, [0, 0, 0], 8);
    expect(heightmap).toMatchObject({ columns: 4, rows: 2, cellWidth: 0.5, cellHeight: 0.5 });
    expect(Array.from(heightmap?.heights ?? [])).toEqual([0, 0, -1, -1, 0, 0, -1, -1]);
    // Turned a quarter about Z, the block is at the bottom.
    const turned = modelHeightmap(
      mesh,
      { min: [...bounds.min], max: [...bounds.max] },
      [0, 0, 90],
      8,
    );
    expect(turned).toMatchObject({ columns: 2, rows: 4 });
    expect(Array.from(turned?.heights ?? [])).toEqual([0, 0, 0, 0, -1, -1, -1, -1]);
  });

  it("has nothing to show of a mesh seen edge-on", () => {
    const wall = new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]);
    expect(modelHeightmap(wall, { min: [0, 0, 0], max: [1, 0, 1] }, [0, 0, 0])).toBeNull();
  });
});
