import type { ProfileOperation, ProfileParams, Shape, Tool } from "@furrow/document";
import { DRAWING_ID } from "@furrow/document/fixtures";
import { describe, expect, it } from "vitest";
import { profileToolpath } from "../toolpaths/profile";
import { toolpathLines } from "./preview";
import {
  type CutterShape,
  cutterProfile,
  type Heightmap,
  type HeightmapGrid,
  heightmapGrid,
  MAX_HEIGHTMAP_CELLS,
  type SimulationCut,
  simulateCuts,
  smallestCutWidth,
} from "./simulation";

const tool: Tool = {
  name: "6 mm upcut",
  type: "flat_end_mill",
  diameter: 6,
  fluteCount: 2,
  fluteLength: 22,
  cutDirection: "upcut",
  vAngle: null,
  tipDiameter: null,
  spindleRpm: 18000,
  feedRate: 1500,
  plungeRate: 500,
  plungeAngle: 3,
  stepDown: 2,
  notes: null,
  color: "#2563eb",
};

const flat: CutterShape = { type: "flat_end_mill", diameter: 6, vAngle: null, tipDiameter: null };
const ball: CutterShape = { type: "ball_end_mill", diameter: 6, vAngle: null, tipDiameter: null };
const vBit: CutterShape = { type: "v_bit", diameter: 12, vAngle: 90, tipDiameter: 0 };

const stock = { width: 120, height: 60, thickness: 6 };

/** 1 mm cells, so cell `(c, r)` is centred at `(c + 0.5, r + 0.5)`. */
const grid: HeightmapGrid = { columns: 120, rows: 60, cellWidth: 1, cellHeight: 1 };

/** The height of the cell centred at `(x, y)`. */
function heightAt({ columns, cellWidth, cellHeight, heights }: Heightmap, x: number, y: number) {
  const column = Math.floor(x / cellWidth);
  const row = Math.floor(y / cellHeight);
  return heights[row * columns + column] as number;
}

function moves(tool: CutterShape, ...points: [number, number, number][]): SimulationCut {
  const segments: number[] = [];
  for (let i = 1; i < points.length; i++)
    segments.push(...(points[i - 1] ?? []), ...(points[i] ?? []));
  return { tool, segments: new Float32Array(segments) };
}

const params: ProfileParams = {
  side: "outside",
  direction: "climb",
  depth: 6,
  allowance: 0,
  finishPass: false,
  leadIn: null,
  ramp: false,
  tabs: null,
};

function profileCut(shape: Shape, overrides: Partial<ProfileParams>): SimulationCut {
  const operation: ProfileOperation = {
    id: "11111111-2222-4333-8444-555555555555",
    name: "Profile",
    enabled: true,
    type: "profile",
    targets: [{ shapeId: shape.id, paths: null }],
    tool,
    params: { ...params, ...overrides },
  };
  const { feeds, rapids } = toolpathLines(
    profileToolpath(operation, [shape], { safeZ: 5, entryClearance: 1 }),
  );
  const segments = new Float32Array(feeds.length + rapids.length);
  segments.set(feeds);
  segments.set(rapids, feeds.length);
  return { tool, segments };
}

/** 40 × 20 mm from (40, 20), counter-clockwise. */
const rectangle: Shape = {
  id: "4f8a1c2e-6b3d-4e5f-9a7b-8c9d0e1f2a3b",
  name: "Rectangle",
  layer: "0",
  drawingId: DRAWING_ID,
  paths: [
    {
      start: [40, 20],
      segments: [
        { kind: "line", to: [80, 20] },
        { kind: "line", to: [80, 40] },
        { kind: "line", to: [40, 40] },
      ],
      closed: true,
    },
  ],
};

const groove: Shape = {
  id: "0d9c8b7a-6f5e-4d3c-ab1a-0f9e8d7c6b5a",
  name: "Groove",
  layer: "0",
  drawingId: DRAWING_ID,
  paths: [{ start: [20.5, 30.5], segments: [{ kind: "line", to: [100.5, 30.5] }], closed: false }],
};

describe("heightmapGrid", () => {
  it("puts twelve cells across the smallest tool, covering the stock exactly", () => {
    expect(heightmapGrid({ width: 120, height: 60 }, 6)).toEqual({
      columns: 240,
      rows: 120,
      cellWidth: 0.5,
      cellHeight: 0.5,
    });
    const { columns, rows, cellWidth, cellHeight } = heightmapGrid({ width: 100, height: 33 }, 3);
    expect(columns * cellWidth).toBeCloseTo(100);
    expect(rows * cellHeight).toBeCloseTo(33);
    expect(cellWidth).toBeLessThanOrEqual(0.25);
    expect(cellHeight).toBeLessThanOrEqual(0.25);
  });

  it("caps the cells on a full sheet with a 3 mm tool", () => {
    const { columns, rows, cellWidth, cellHeight } = heightmapGrid(
      { width: 2440, height: 1220 },
      3,
    );
    expect(columns * rows).toBeLessThanOrEqual(MAX_HEIGHTMAP_CELLS);
    expect(columns * rows).toBeGreaterThan(MAX_HEIGHTMAP_CELLS * 0.99);
    expect(cellWidth / cellHeight).toBeCloseTo(1, 2);
    expect(cellWidth).toBeCloseTo(0.6, 1);
  });

  it("takes a lower cap", () => {
    const { columns, rows } = heightmapGrid({ width: 2440, height: 1220 }, 3, 2048 * 2048);
    expect(columns * rows).toBeLessThanOrEqual(2048 * 2048);
    expect(columns * rows).toBeGreaterThan(2048 * 2048 * 0.99);
  });
});

describe("cutterProfile", () => {
  it("is flat for end mills and drills, a hemisphere for balls and a cone for V-bits", () => {
    expect(cutterProfile(flat).height(2.9)).toBe(0);
    expect(cutterProfile({ ...flat, type: "drill" }).flat).toBe(true);
    expect(cutterProfile(ball).height(3)).toBeCloseTo(3);
    expect(cutterProfile(ball).height(0)).toBe(0);
    /** 90° included angle: rises 1 mm per mm off the axis. */
    expect(cutterProfile(vBit).height(4)).toBeCloseTo(4);
    expect(cutterProfile({ ...vBit, tipDiameter: 2 }).height(4)).toBeCloseTo(3);
  });
});

describe("cutterProfile reach", () => {
  it("is how far off the axis the edge dips below a depth, at most the radius", () => {
    expect(cutterProfile(flat).reach(0.1)).toBe(3);
    expect(cutterProfile(ball).reach(1)).toBeCloseTo(Math.sqrt(5));
    expect(cutterProfile(ball).reach(4)).toBe(3);
    expect(cutterProfile(vBit).reach(4)).toBeCloseTo(4);
    expect(cutterProfile(vBit).reach(10)).toBe(6);
    expect(cutterProfile({ ...vBit, tipDiameter: 2 }).reach(3)).toBeCloseTo(4);
  });
});

describe("smallestCutWidth", () => {
  it("is a flat tool's diameter, however shallow", () => {
    expect(smallestCutWidth([moves(flat, [0, 0, -0.1], [10, 0, -0.1])])).toBe(6);
  });

  it("is a ball's chord at its deepest move", () => {
    expect(smallestCutWidth([moves(ball, [0, 0, -1], [10, 0, -1])])).toBeCloseTo(2 * Math.sqrt(5));
  });

  it("is a V-bit's groove a quarter of the way down its deepest move, far narrower than the bit", () => {
    // 90°: 8 mm deep at most, so the groove 2 mm down, 4 mm wide.
    expect(smallestCutWidth([moves(vBit, [0, 0, 0], [10, 0, -8], [20, 0, -1])])).toBeCloseTo(4);
  });

  it("takes the narrowest cut and ignores moves above the stock", () => {
    const above = moves(flat, [0, 0, 5], [10, 0, 0]);
    expect(smallestCutWidth([above])).toBe(Infinity);
    expect(smallestCutWidth([])).toBe(Infinity);
    expect(smallestCutWidth([above, moves(vBit, [0, 0, -4], [10, 0, -4])])).toBeCloseTo(2);
  });
});

describe("simulateCuts", () => {
  it("leaves the stock whole without cuts", () => {
    const { heights } = simulateCuts(stock, [], grid);
    expect(heights.every((h) => h === 0)).toBe(true);
  });

  it("cuts a profile through the stock around the part, leaving it standing", () => {
    const map = simulateCuts(stock, [profileCut(rectangle, { depth: 6 })], grid);
    /** The tool's centre runs 3 mm outside the outline, its edge on it. */
    expect(heightAt(map, 37.5, 30.5)).toBe(-6);
    expect(heightAt(map, 60.5, 17.5)).toBe(-6);
    expect(heightAt(map, 60.5, 42.5)).toBe(-6);
    expect(heightAt(map, 40.5, 30.5)).toBe(0);
    expect(heightAt(map, 60.5, 30.5)).toBe(0);
    /** Outside the slot the tool cut. */
    expect(heightAt(map, 33.5, 30.5)).toBe(0);
    expect(heightAt(map, 10.5, 10.5)).toBe(0);
  });

  it("pads the buffer under the heights to whole rows when asked", () => {
    const { heights } = simulateCuts(stock, [], grid, 2048);
    expect(heights).toHaveLength(120 * 60);
    expect(heights.buffer.byteLength).toBe(4 * 2048 * 4);
  });

  it("never cuts below the stock bottom", () => {
    const map = simulateCuts(stock, [moves(flat, [10, 10, -20], [50, 10, -20])], grid);
    expect(Math.min(...map.heights)).toBe(-6);
  });

  it("cuts a partial-depth slot as wide as the tool", () => {
    const map = simulateCuts(stock, [profileCut(groove, { side: "on", depth: 3 })], grid);
    expect(heightAt(map, 60.5, 30.5)).toBe(-3);
    expect(heightAt(map, 60.5, 32.5)).toBe(-3);
    expect(heightAt(map, 60.5, 33.5)).toBe(-3);
    expect(heightAt(map, 60.5, 34.5)).toBe(0);
    expect(heightAt(map, 60.5, 26.5)).toBe(0);
    /** Round ends: the corner of the tool's square around the end isn't cut. */
    expect(heightAt(map, 103.5, 32.5)).toBe(0);
    expect(heightAt(map, 102.5, 30.5)).toBe(-3);
    expect(Math.min(...map.heights)).toBe(-3);
  });

  it("follows a ramp entry down to the depth", () => {
    /** A flat tool reaches each cell lowest where it last covers it. */
    const map = simulateCuts(stock, [moves(flat, [10.5, 30.5, 0], [50.5, 30.5, -4])], grid);
    expect(heightAt(map, 30.5, 30.5)).toBeCloseTo(-4 * (23 / 40), 5);
    expect(heightAt(map, 50.5, 30.5)).toBeCloseTo(-4, 5);
    expect(heightAt(map, 9.5, 30.5)).toBeCloseTo(-0.2, 5);
    expect(heightAt(map, 6.5, 30.5)).toBe(0);
    /** Ramped in by a profile, the slot ends at the depth without overcutting. */
    const ramped = simulateCuts(
      stock,
      [profileCut(groove, { side: "on", depth: 2, ramp: true })],
      grid,
    );
    expect(heightAt(ramped, 60.5, 30.5)).toBeCloseTo(-2, 5);
    expect(Math.min(...ramped.heights)).toBeCloseTo(-2, 5);
  });

  it("sweeps a ball end mill's hemisphere, also along a ramp", () => {
    const level = simulateCuts(stock, [moves(ball, [10.5, 30.5, -3], [80.5, 30.5, -3])], grid);
    expect(heightAt(level, 40.5, 30.5)).toBeCloseTo(-3);
    expect(heightAt(level, 40.5, 32.5)).toBeCloseTo(-3 + 3 - Math.sqrt(5), 5);
    const ramp = simulateCuts(stock, [moves(ball, [10.5, 30.5, 0], [70.5, 30.5, -3])], grid);
    /** Off the axis, the lowest point is further along than the cell itself. */
    const reached = Math.min(
      ...Array.from({ length: 6001 }, (_, i) => {
        const t = i / 6000;
        const along = 10.5 + 60 * t;
        const d = Math.hypot(40.5 - along, 2);
        return d > 3 ? Infinity : -3 * t + 3 - Math.sqrt(9 - d * d);
      }),
    );
    expect(heightAt(ramp, 40.5, 32.5)).toBeCloseTo(reached, 4);
  });

  it("cuts a V-groove that widens with depth", () => {
    const map = simulateCuts(stock, [moves(vBit, [10.5, 30.5, -3], [80.5, 30.5, -3])], grid);
    expect(heightAt(map, 40.5, 30.5)).toBeCloseTo(-3);
    expect(heightAt(map, 40.5, 32.5)).toBeCloseTo(-1);
    expect(heightAt(map, 40.5, 34.5)).toBe(0);
  });

  it("sweeps a V-bit along a slope out to where it leaves the stock", () => {
    // 0.1 mm down per mm, from the top to 7 mm deep: the V-carve's moves.
    const map = simulateCuts(stock, [moves(vBit, [10.5, 30.5, 0], [80.5, 30.5, -7])], grid);
    // 3 mm off the move at 3.5 mm deep: the cone reaches lowest a little further on.
    const u = 0.3 / Math.sqrt(0.99);
    expect(heightAt(map, 45.5, 33.5)).toBeCloseTo(-3.5 - 0.1 * u + Math.sqrt(9 + u * u), 4);
    // At the end, 6 mm off: the bit's full radius, 1 mm below the top.
    expect(heightAt(map, 80.5, 36.5)).toBeCloseTo(-1, 4);
    expect(heightAt(map, 20.5, 33.5)).toBe(0);
  });

  it("drills a hole the size of the tool", () => {
    const map = simulateCuts(stock, [moves(flat, [60.5, 30.5, 2], [60.5, 30.5, -4])], grid);
    expect(heightAt(map, 60.5, 30.5)).toBe(-4);
    expect(heightAt(map, 62.5, 32.5)).toBe(-4);
    expect(heightAt(map, 63.5, 32.5)).toBe(0);
  });

  it("ignores moves above the stock", () => {
    const map = simulateCuts(stock, [moves(flat, [10, 10, 5], [100, 50, 0])], grid);
    expect(map.heights.every((h) => h === 0)).toBe(true);
  });
});
