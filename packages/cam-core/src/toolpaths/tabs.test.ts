import type { Point, Shape } from "@furrow/document";
import { DRAWING_ID } from "@furrow/document/fixtures";
import { describe, expect, it } from "vitest";
import {
  autoTabPositions,
  closedLoops,
  coveredSpans,
  freeSpans,
  inSpans,
  nearestOnLoops,
  tabFrame,
} from "./tabs";

/** 100 × 100 mm, drawn from its bottom-left corner. */
const square: Shape = {
  id: "4f8a1c2e-6b3d-4e5f-9a7b-8c9d0e1f2a3b",
  name: "Square",
  layer: "0",
  drawingId: DRAWING_ID,
  paths: [
    {
      start: [0, 0],
      segments: [
        { kind: "line", to: [100, 0] },
        { kind: "line", to: [100, 100] },
        { kind: "line", to: [0, 100] },
      ],
      closed: true,
    },
  ],
};

/** Radius 10 around (50, 50). */
const hole: Shape = {
  id: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
  name: "Hole",
  layer: "0",
  drawingId: DRAWING_ID,
  paths: [
    {
      start: [60, 50],
      segments: [{ kind: "arc", to: [60, 50], center: [50, 50], clockwise: false }],
      closed: true,
    },
  ],
};

const line: Shape = {
  id: "0d9c8b7a-6f5e-4d3c-ab1a-0f9e8d7c6b5a",
  name: "Groove",
  layer: "0",
  drawingId: DRAWING_ID,
  paths: [{ start: [10, 10], segments: [{ kind: "line", to: [90, 10] }], closed: false }],
};

function rounded(points: Point[]): Point[] {
  return points.map(([x, y]) => [Math.round(x * 1e6) / 1e6, Math.round(y * 1e6) / 1e6]);
}

describe("autoTabPositions", () => {
  it("spreads a count of tabs evenly, half a gap from the start", () => {
    expect(rounded(autoTabPositions([square], "outside", { count: 4 }))).toEqual([
      [50, 0],
      [100, 50],
      [50, 100],
      [0, 50],
    ]);
  });

  it("places one tab per spacing, rounded, at least one", () => {
    expect(autoTabPositions([square], "outside", { spacing: 120 })).toHaveLength(3);
    expect(autoTabPositions([square], "outside", { spacing: 1000 })).toHaveLength(1);
  });

  it("tabs only the outlines of an outside profile, every contour otherwise", () => {
    const outside = autoTabPositions([square, hole], "outside", { count: 2 });
    expect(rounded(outside)).toEqual([
      [100, 0],
      [0, 100],
    ]);
    expect(autoTabPositions([square, hole], "inside", { count: 2 })).toHaveLength(4);
    expect(autoTabPositions([square, hole], "on", { count: 2 })).toHaveLength(4);
  });

  it("skips open paths", () => {
    expect(autoTabPositions([line], "on", { count: 3 })).toEqual([]);
  });
});

describe("closedLoops", () => {
  it("flattens the closed paths, each ending on its start", () => {
    const loops = closedLoops([square, hole, line]);
    expect(loops).toHaveLength(2);
    expect(loops[0]).toEqual([
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
      [0, 0],
    ]);
  });
});

describe("nearestOnLoops", () => {
  it("snaps to the nearest closed path", () => {
    const loops = closedLoops([square, hole, line]);
    const nearest = nearestOnLoops(loops, [52, 12]);
    expect(rounded([nearest?.point as Point])).toEqual([[52, 0]]);
    expect(nearest?.distance).toBeCloseTo(12, 6);
    expect(nearestOnLoops(loops, [50, 45])?.distance).toBeCloseTo(5, 1);
    expect(nearestOnLoops([], [0, 0])).toBeNull();
  });
});

describe("tabFrame", () => {
  function frame(side: "outside" | "inside" | "on", position: Point, shapes = [square]) {
    const result = tabFrame(closedLoops(shapes), side, position, 6);
    if (!result) throw new Error("no frame");
    return { center: rounded([result.center])[0], angle: Math.round(result.angle * 1e6) / 1e6 };
  }

  it("sits in the slot on the waste side, along the contour", () => {
    expect(frame("outside", [50, 1])).toEqual({ center: [50, -3], angle: 0 });
    expect(frame("inside", [50, 1])).toEqual({ center: [50, 3], angle: 0 });
    expect(frame("on", [50, 1])).toEqual({ center: [50, 0], angle: 0 });
    expect(frame("outside", [100, 50])).toEqual({
      center: [103, 50],
      angle: Math.round((Math.PI / 2) * 1e6) / 1e6,
    });
  });

  it("goes into a hole for an outside profile around it", () => {
    const { center } = frame("outside", [50, 61], [square, hole]);
    expect(Math.hypot((center?.[0] ?? 0) - 50, (center?.[1] ?? 0) - 50)).toBeCloseTo(7, 1);
  });

  it("needs closed paths", () => {
    expect(tabFrame(closedLoops([line]), "on", [0, 0], 6)).toBeNull();
  });
});

describe("coveredSpans", () => {
  it("merges overlapping spans and splits one across the start", () => {
    expect(coveredSpans([10, 14, 50], 6, 100)).toEqual([
      [7, 17],
      [47, 53],
    ]);
    expect(coveredSpans([1], 6, 100)).toEqual([
      [0, 4],
      [98, 100],
    ]);
    expect(coveredSpans([50], 200, 100)).toEqual([[0, 100]]);
    expect(coveredSpans([], 6, 100)).toEqual([]);
  });
});

describe("freeSpans", () => {
  it("lists what the spans leave free, ends included", () => {
    expect(
      freeSpans(
        [
          [10, 20],
          [30, 40],
        ],
        100,
      ),
    ).toEqual([
      [0, 10],
      [20, 30],
      [40, 100],
    ]);
    expect(
      freeSpans(
        [
          [0, 4],
          [90, 100],
        ],
        100,
      ),
    ).toEqual([[4, 90]]);
    expect(freeSpans([[0, 100]], 100)).toEqual([]);
    expect(freeSpans([], 100)).toEqual([[0, 100]]);
  });
});

describe("inSpans", () => {
  it("excludes the ends", () => {
    expect(inSpans([[10, 20]], 15)).toBe(true);
    expect(inSpans([[10, 20]], 10)).toBe(false);
    expect(inSpans([[10, 20]], 25)).toBe(false);
  });
});
