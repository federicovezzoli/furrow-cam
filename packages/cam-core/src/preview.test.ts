import { describe, expect, it } from "vitest";
import { toolpathLines, toolpathLinesBuffers } from "./preview";
import type { Toolpath, ToolpathMove } from "./toolpath";

const rapid = (x: number, y: number, z: number): ToolpathMove => ({ kind: "rapid", to: [x, y, z] });
const feed = (x: number, y: number, z: number): ToolpathMove => ({
  kind: "feed",
  to: [x, y, z],
  feedRate: 100,
});

const lines = (...moves: ToolpathMove[]) => toolpathLines({ moves, warnings: [] } as Toolpath);

describe("toolpathLines", () => {
  it("splits moves into rapid and feed segments from where the last one ended", () => {
    const result = lines(rapid(0, 0, 5), feed(0, 0, -1), feed(10, 0, -1), rapid(10, 0, 5));
    expect([...result.rapids]).toEqual([10, 0, -1, 10, 0, 5]);
    expect([...result.feeds]).toEqual([0, 0, 5, 0, 0, -1, 0, 0, -1, 10, 0, -1]);
  });

  it("draws no segment for the first move, which has no start", () => {
    const result = lines(rapid(3, 4, 5));
    expect(result.rapids).toHaveLength(0);
    expect(result.feeds).toHaveLength(0);
    expect(lines().rapids).toHaveLength(0);
  });

  it("marks straight plunges, merging pecks into the deepest", () => {
    const result = lines(
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
    expect([...result.plunges]).toEqual([1, 2, -6, 8, 9, -6]);
  });

  it("doesn't mark ramps, helices or moves up", () => {
    const result = lines(rapid(0, 0, 5), feed(4, 0, -1), feed(4, 0, 2), feed(4, 0, 2));
    expect(result.plunges).toHaveLength(0);
  });

  it("exposes its buffers for transfer", () => {
    const result = lines(rapid(0, 0, 5), feed(0, 0, -1));
    expect(toolpathLinesBuffers(result)).toEqual([
      result.feeds.buffer,
      result.rapids.buffer,
      result.plunges.buffer,
    ]);
  });
});
