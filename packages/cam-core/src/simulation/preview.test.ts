import { describe, expect, it } from "vitest";
import type { Toolpath, ToolpathMove } from "../toolpaths/toolpath";
import { DEEPEST_SHADE, toolpathLines, toolpathLinesBuffers } from "./preview";

const rapid = (x: number, y: number, z: number): ToolpathMove => ({ kind: "rapid", to: [x, y, z] });
const feed = (x: number, y: number, z: number): ToolpathMove => ({
  kind: "feed",
  to: [x, y, z],
  feedRate: 100,
});

const toolpath = (...moves: ToolpathMove[]): Toolpath => ({ moves, warnings: [] });

/** The `[x, y, z]` vertices of `LineSegments` positions. */
const vertices = (positions: Float32Array) =>
  Array.from({ length: positions.length / 3 }, (_, i) =>
    Array.from(positions.subarray(i * 3, i * 3 + 3)),
  );

/** A pecked hole at `[1, 2]` and a plain one at `[8, 9]`, both 6 mm deep. */
const drilled = toolpath(
  rapid(1, 2, 5),
  feed(1, 2, -3),
  rapid(1, 2, 0.5),
  rapid(1, 2, -2.5),
  feed(1, 2, -6),
  rapid(1, 2, 5),
  rapid(8, 9, 5),
  feed(8, 9, -6),
  rapid(8, 9, 5),
);

describe("toolpathLines", () => {
  it("splits moves into rapid and feed segments from where the last one ended", () => {
    const lines = toolpathLines(
      toolpath(rapid(0, 0, 5), feed(0, 0, -1), feed(10, 0, -1), rapid(10, 0, 5)),
    );
    expect([...lines.rapids]).toEqual([10, 0, -1, 10, 0, 5]);
    expect([...lines.feeds]).toEqual([0, 0, 5, 0, 0, -1, 0, 0, -1, 10, 0, -1]);
  });

  it("measures each rapid from its own start, for dashes", () => {
    const lines = toolpathLines(
      toolpath(rapid(0, 0, 0), rapid(3, 4, 0), feed(3, 4, -1), rapid(3, 4, 1)),
    );
    expect([...lines.rapidDistances]).toEqual([0, 5, 0, 2]);
  });

  it("draws no segment for the first move, which has no start", () => {
    const lines = toolpathLines(toolpath(rapid(3, 4, 5)));
    expect(lines.rapids).toHaveLength(0);
    expect(lines.feeds).toHaveLength(0);
    expect(toolpathLines(toolpath()).rapids).toHaveLength(0);
  });

  it("marks no holes unless asked", () => {
    expect(toolpathLines(drilled).holes).toHaveLength(0);
  });

  it("circles each drilled hole at its bottom, merging its pecks", () => {
    const { holes } = toolpathLines(drilled, { holeRadius: 3 });
    const points = vertices(holes);
    expect(points).toHaveLength(2 * 24 * 2);
    expect(points[0]).toEqual([4, 2, -6]);
    for (const [index, [x, y, z]] of points.entries() as Iterable<[number, number[]]>) {
      const [cx, cy] = index < 48 ? [1, 2] : [8, 9];
      expect(Math.hypot((x as number) - cx, (y as number) - cy)).toBeCloseTo(3, 5);
      expect(z).toBe(-6);
    }
  });

  it("doesn't mark ramps, helices or moves up", () => {
    const lines = toolpathLines(
      toolpath(rapid(0, 0, 5), feed(4, 0, -1), feed(4, 0, 2), feed(4, 0, 2)),
      { holeRadius: 3 },
    );
    expect(lines.holes).toHaveLength(0);
  });

  it("exposes its buffers for transfer", () => {
    const lines = toolpathLines(drilled, { holeRadius: 3 });
    expect(toolpathLinesBuffers(lines)).toEqual([
      lines.feeds.buffer,
      lines.rapids.buffer,
      lines.rapidDistances.buffer,
      lines.holes.buffer,
      lines.feedColors.buffer,
    ]);
  });

  it("shades no feeds unless asked", () => {
    expect(toolpathLines(drilled).feedColors).toHaveLength(0);
  });

  it("shades feeds darker the deeper they are, from the stock top down", () => {
    const carved = toolpath(rapid(0, 0, 5), feed(0, 0, 1), feed(5, 0, -2), feed(10, 0, -4));
    const { feeds, feedColors } = toolpathLines(carved, { shadeDepth: true });
    expect(feedColors).toHaveLength(feeds.length);
    const half = 1 - (1 - DEEPEST_SHADE) / 2;
    // Above the stock counts as the top; every vertex is grey, R = G = B.
    expect(vertices(feedColors).map((color) => color[0])).toEqual(
      [1, 1, 1, half, half, DEEPEST_SHADE].map(Math.fround),
    );
    for (const [r, g, b] of vertices(feedColors)) expect([g, b]).toEqual([r, r]);
  });
});
