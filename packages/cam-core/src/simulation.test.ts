import type { ProfileOperation, ProfileParams, Shape, Tool } from "@furrow/document";
import { describe, expect, it } from "vitest";
import { toolpathLines } from "./preview";
import { profileToolpath } from "./profile";
import {
  type CutterShape,
  cutterProfile,
  type Heightmap,
  type HeightmapGrid,
  heightmapGrid,
  MAX_HEIGHTMAP_CELLS,
  type SimulationCut,
  simulateCuts,
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
  stepOver: 40,
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
  paths: [{ start: [20.5, 30.5], segments: [{ kind: "line", to: [100.5, 30.5] }], closed: false }],
};

describe("heightmapGrid", () => {
  it("puts six cells across the smallest tool, covering the stock exactly", () => {
    expect(heightmapGrid({ width: 120, height: 60 }, 6)).toEqual({
      columns: 120,
      rows: 60,
      cellWidth: 1,
      cellHeight: 1,
    });
    const { columns, rows, cellWidth, cellHeight } = heightmapGrid({ width: 100, height: 33 }, 3);
    expect(columns * cellWidth).toBeCloseTo(100);
    expect(rows * cellHeight).toBeCloseTo(33);
    expect(cellWidth).toBeLessThanOrEqual(0.5);
    expect(cellHeight).toBeLessThanOrEqual(0.5);
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
