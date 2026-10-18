import type { Box3 } from "@furrow/cam-core";
import type { Path, Shape } from "@furrow/document";
import { describe, expect, it } from "vitest";
import {
  boxCenter,
  boxWithPoint,
  fitOrbitPosition,
  fitTopZoom,
  gridLinePositions,
  MAX_GRID_LINES,
  POINT_MARKER_SIZE,
  pathLinePositions,
  pathsLinePositions,
  pixelsPerMillimetre,
  shapeLinePositions,
  shapesLinePositions,
  touchOffLinePositions,
} from "./viewport-scene";

const shape = (id: string, paths: Shape["paths"]): Shape => ({ id, name: "", layer: "0", paths });

const square = shape("a", [
  {
    start: [0, 0],
    segments: [
      { kind: "line", to: [10, 0] },
      { kind: "line", to: [10, 10] },
    ],
    closed: true,
  },
]);

const stock: Box3 = { min: [0, 0, -18], max: [600, 400, 0] };

describe("shapeLinePositions", () => {
  it("draws each polyline edge as a segment on the stock top", () => {
    const positions = shapeLinePositions(square);
    // biome-ignore format: one segment per row
    expect([...positions]).toEqual([
      0, 0, 0, 10, 0, 0,
      10, 0, 0, 10, 10, 0,
      10, 10, 0, 0, 0, 0,
    ]);
  });

  it("draws a single point as a cross", () => {
    const positions = shapeLinePositions(
      shape("b", [{ start: [1, 2], segments: [], closed: false }]),
    );
    const s = POINT_MARKER_SIZE;
    expect([...positions]).toEqual([1 - s, 2, 0, 1 + s, 2, 0, 1, 2 - s, 0, 1, 2 + s, 0]);
  });

  it("merges shapes into one buffer, in order", () => {
    const point = shape("b", [{ start: [1, 2], segments: [], closed: false }]);
    expect([...shapesLinePositions([square, point])]).toEqual([
      ...shapeLinePositions(square),
      ...shapeLinePositions(point),
    ]);
    expect(shapesLinePositions([])).toHaveLength(0);
  });

  it("draws chosen paths of a shape on their own", () => {
    const point: Path = { start: [1, 2], segments: [], closed: false };
    const two = shape("b", [...square.paths, point]);
    expect([...pathsLinePositions(two.paths.slice(1))]).toEqual([...pathLinePositions(point)]);
    expect([...pathsLinePositions(two.paths)]).toEqual([...shapeLinePositions(two)]);
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

  it("reaches an origin outside the stock", () => {
    const { major } = gridLinePositions(
      { min: [20, -45, -18], max: [40, -25, 0] },
      { spacing: 10, majorEvery: 1, margin: 0 },
    );
    // x = 0…40, y = -50…0: the stock alone would give x = 20…40, y = -50…-20.
    expect(major.slice(0, 6)).toEqual(new Float32Array([0, -50, -18, 0, 0, -18]));
    expect(major.slice(-6)).toEqual(new Float32Array([0, 0, -18, 40, 0, -18]));
  });

  it("gets coarser instead of drawing more than MAX_GRID_LINES along an axis", () => {
    // 900 m across: 10 mm lines would be 90,000, 1000 mm ones are 900 (majors every 10 m).
    const far = gridLinePositions({ min: [-9e5, 0, -18], max: [600, 400, 0] });
    expect((far.minor.length + far.major.length) / 6).toBeLessThanOrEqual(2 * (MAX_GRID_LINES + 2));
    expect(far.minor.slice(0, 6)).toEqual(
      new Float32Array([-901000, -1000, -18, -901000, 1000, -18]),
    );
    expect(far.major.slice(0, 6)).toEqual(new Float32Array([-9e5, -1000, -18, -9e5, 1000, -18]));

    const huge = gridLinePositions({ min: [-1e300, 0, -18], max: [600, 400, 0] });
    expect((huge.minor.length + huge.major.length) / 6).toBeLessThanOrEqual(
      2 * (MAX_GRID_LINES + 2),
    );
  });
});

describe("camera fitting", () => {
  it("grows the fitted box to reach a point outside it", () => {
    expect(boxWithPoint(stock, [-20, 450, 0])).toEqual({
      min: [-20, stock.min[1], stock.min[2]],
      max: [stock.max[0], 450, stock.max[2]],
    });
    expect(boxWithPoint(stock, boxCenter(stock))).toEqual(stock);
  });

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

describe("pixelsPerMillimetre", () => {
  it("is the zoom of an orthographic camera", () => {
    expect(pixelsPerMillimetre({ zoom: 2.5 }, 800, 1000)).toBe(2.5);
  });

  it("follows the distance of a perspective camera", () => {
    // 90° fov: 200 mm visible at 100 mm away.
    expect(pixelsPerMillimetre({ zoom: 1, fov: 90 }, 800, 100)).toBeCloseTo(4);
    expect(pixelsPerMillimetre({ zoom: 1, fov: 90 }, 800, 200)).toBeCloseTo(2);
  });
});

describe("touchOffLinePositions", () => {
  it("draws a ring at the pad's diameter around a cross at its centre", () => {
    const { ring, distances, cross } = touchOffLinePositions({ x: 20, y: 10, diameter: 15 });
    expect(ring.length / 3).toBe(distances.length);
    for (let i = 0; i < ring.length; i += 3) {
      expect(Math.hypot((ring[i] ?? 0) - 20, (ring[i + 1] ?? 0) - 10)).toBeCloseTo(7.5, 4);
      expect(ring[i + 2]).toBe(0);
    }
    // Distances run along the ring, to about its circumference.
    expect(distances[0]).toBe(0);
    expect(distances.at(-1)).toBeCloseTo(15 * Math.PI, 1);
    expect(Array.from(cross)).toEqual([17.5, 10, 0, 22.5, 10, 0, 20, 7.5, 0, 20, 12.5, 0]);
  });
});
