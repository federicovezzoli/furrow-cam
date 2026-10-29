import { describe, expect, it } from "vitest";
import {
  heightmapPlayback,
  moveStartDistance,
  type PlaybackPath,
  playbackPath,
  playbackPosition,
} from "./playback";
import {
  type CutterShape,
  heightmapGrid,
  joinSides,
  type SimulationCut,
  simulateCuts,
  smallestCutWidth,
} from "./simulation";

const flat: CutterShape = { type: "flat_end_mill", diameter: 6, vAngle: null, tipDiameter: null };
const ball: CutterShape = { type: "ball_end_mill", diameter: 3, vAngle: null, tipDiameter: null };

const stock = { width: 120, height: 60, thickness: 6 };

/** Moves through `points`, `[x, y, z]` each, as one cut's segments. */
function cut(tool: CutterShape, points: [number, number, number][]): SimulationCut {
  const segments: number[] = [];
  points.slice(1).forEach((point, i) => {
    segments.push(...(points[i] as [number, number, number]), ...point);
  });
  return { tool, segments: new Float32Array(segments) };
}

/** Where the tool is after `distance` along a path that has moves. */
function positionAt(path: PlaybackPath, distance: number) {
  const position = playbackPosition(path, distance);
  if (!position) throw new Error("No moves");
  return position;
}

const cuts = [
  // A rapid down, a slot along X, a rapid up: 5 + 100 + 5 mm.
  cut(flat, [
    [10, 30, 5],
    [10, 30, -2],
    [110, 30, -2],
    [110, 30, 5],
  ]),
  // A groove along Y with the other tool: 3 + 40 mm.
  cut(ball, [
    [60, 10, 1],
    [60, 10, -2],
    [60, 50, -2],
  ]),
];

describe("playbackPath", () => {
  it("numbers the moves across the cuts and measures how far the tool travels", () => {
    const path = playbackPath(cuts);
    expect([...path.firstMoves]).toEqual([0, 3, 5]);
    expect([...path.ends]).toEqual([7, 107, 114, 117, 157]);
    expect(path.length).toBe(157);
    expect(moveStartDistance(path, 0)).toBe(0);
    expect(moveStartDistance(path, 3)).toBe(114);
    expect(moveStartDistance(path, 5)).toBe(157);
  });

  it("places the tool along the move under way", () => {
    const path = playbackPath(cuts);
    expect(playbackPosition(path, 0)).toEqual({ move: 0, fraction: 0, cut: 0, point: [10, 30, 5] });
    expect(playbackPosition(path, 57)).toEqual({
      move: 1,
      fraction: 0.5,
      cut: 0,
      point: [60, 30, -2],
    });
    expect(playbackPosition(path, 137)).toEqual({
      move: 4,
      fraction: 0.5,
      cut: 1,
      point: [60, 30, -2],
    });
    // Past the end, every move is done.
    expect(playbackPosition(path, 1000)).toEqual({
      move: 5,
      fraction: 0,
      cut: 1,
      point: [60, 50, -2],
    });
    expect(playbackPosition(playbackPath([]), 0)).toBeNull();
  });
});

describe("heightmapPlayback", () => {
  // Six cells across the narrowest cut, coarser than the default: the same logic, faster.
  const grid = heightmapGrid(stock, 2 * smallestCutWidth(cuts));

  function heightsAfter(path: PlaybackPath, distance: number) {
    const playback = heightmapPlayback(stock, path, grid);
    const at = positionAt(path, distance);
    playback.seek(at.move, at.fraction);
    return playback.heightmap.heights;
  }

  it("ends with the stock the whole simulation leaves", () => {
    const path = playbackPath(cuts);
    const playback = heightmapPlayback(stock, path, grid);
    playback.seek(path.ends.length, 0);
    expect(playback.heightmap.heights).toEqual(simulateCuts(stock, cuts, grid).heights);
  });

  it("cuts part of a move as far as the tool has gone", () => {
    const path = playbackPath(cuts);
    const playback = heightmapPlayback(stock, path, grid);
    const at = positionAt(path, 57);
    const changed = playback.seek(at.move, at.fraction);
    // Halfway along the slot: cut where the tool has been, not beyond.
    const { heights, columns, cellWidth, cellHeight } = playback.heightmap;
    const cell = (x: number, y: number) =>
      heights[Math.floor(y / cellHeight) * columns + Math.floor(x / cellWidth)];
    expect(cell(30, 30)).toBeCloseTo(-2);
    expect(cell(90, 30)).toBe(0);
    // Only rows near the slot changed.
    expect(changed?.start).toBeGreaterThan(0);
    expect(changed?.end).toBeLessThan(heights.length);
  });

  it("gives the same stock however it got there", () => {
    const path = playbackPath(cuts);
    const playback = heightmapPlayback(stock, path, grid);
    for (const distance of [157, 20, 140, 57, 0, 110, 57]) {
      const at = positionAt(path, distance);
      playback.seek(at.move, at.fraction);
      expect(playback.heightmap.heights, `at ${distance} mm`).toEqual(heightsAfter(path, distance));
    }
  });

  it("gives the same stock with more moves than checkpoints", () => {
    // 200 moves zigzagging across the stock, more than the 64 checkpoints kept.
    const points: [number, number, number][] = [[5, 5, -1]];
    for (let i = 1; i <= 200; i++) points.push([i % 2 === 0 ? 5 : 115, 5 + i * 0.25, -1 - i / 100]);
    const zigzag = playbackPath([cut(flat, points)]);
    const playback = heightmapPlayback(stock, zigzag, grid);
    for (const distance of [zigzag.length, 3000, 9000, 4321.5, 10, 20000]) {
      const at = positionAt(zigzag, distance);
      playback.seek(at.move, at.fraction);
      expect(playback.heightmap.heights, `at ${distance} mm`).toEqual(
        heightsAfter(zigzag, distance),
      );
    }
  });

  it("keeps cuts above the stock bottom", () => {
    const deep = [
      cut(flat, [
        [10, 30, 5],
        [10, 30, -20],
        [50, 30, -20],
      ]),
    ];
    const path = playbackPath(deep);
    const playback = heightmapPlayback(stock, path, heightmapGrid(stock, 6));
    playback.seek(1, 0.5);
    expect(Math.min(...playback.heightmap.heights)).toBe(-stock.thickness);
  });

  it("reports no change when nothing goes into the stock", () => {
    const above = [
      cut(flat, [
        [10, 30, 5],
        [50, 30, 5],
      ]),
    ];
    const playback = heightmapPlayback(stock, playbackPath(above), grid);
    expect(playback.seek(1, 0)).toBeNull();
  });

  describe("from the stock the top side left", () => {
    // The top side's cuts, flipped: cut through on the first rows, 4 mm deep below the middle.
    const cells = grid.columns * grid.rows;
    const flippedTop = new Float32Array(cells).map((_, i) =>
      i < grid.columns ? -stock.thickness : i < cells / 2 ? -4 : 0,
    );

    it("starts with the cells the top side cut through", () => {
      const playback = heightmapPlayback(stock, playbackPath(cuts), grid, 1, flippedTop);
      const { heights } = playback.heightmap;
      expect(heights[0]).toBe(-stock.thickness);
      expect(heights[cells - 1]).toBe(0);
      expect(playback.seek(0, 0)).toBeNull();
    });

    it("ends with the stock the simulation leaves, cut through where the sides meet", () => {
      const path = playbackPath(cuts);
      const playback = heightmapPlayback(stock, path, grid, 1, flippedTop);
      playback.seek(path.ends.length, 0);
      const expected = simulateCuts(stock, cuts, grid).heights;
      joinSides(expected, flippedTop, stock.thickness);
      expect(playback.heightmap.heights).toEqual(expected);
      expect(expected.filter((h) => h === -stock.thickness).length).toBeGreaterThan(grid.columns);
    });

    it("goes back to where it started", () => {
      const path = playbackPath(cuts);
      const playback = heightmapPlayback(stock, path, grid, 1, flippedTop);
      const start = playback.heightmap.heights.slice();
      playback.seek(path.ends.length, 0);
      playback.seek(0, 0);
      expect(playback.heightmap.heights).toEqual(start);
    });
  });

  it("pads the buffer like simulateCuts", () => {
    const playback = heightmapPlayback(stock, playbackPath(cuts), grid, 2048);
    expect(playback.heightmap.heights.buffer.byteLength % (2048 * 4)).toBe(0);
  });
});
