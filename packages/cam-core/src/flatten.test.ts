import { distance, type Path, type Point } from "@furrow/document";
import { describe, expect, it } from "vitest";
import { flattenPath } from "./flatten";

describe("flattenPath", () => {
  it("keeps lines and closes the path back to its start", () => {
    const path: Path = {
      start: [0, 0],
      segments: [
        { kind: "line", to: [10, 0] },
        { kind: "line", to: [10, 10] },
      ],
      closed: true,
    };
    expect(flattenPath(path)).toEqual([
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 0],
    ]);
  });

  it("doesn't repeat the start of a closed path that already ends there", () => {
    const path: Path = {
      start: [0, 0],
      segments: [
        { kind: "line", to: [10, 0] },
        { kind: "line", to: [0, 10] },
        { kind: "line", to: [0, 0] },
      ],
      closed: true,
    };
    expect(flattenPath(path)).toHaveLength(4);
  });

  it("ends a closed path exactly on its start when the last segment stops just short", () => {
    const path: Path = {
      start: [0, 0],
      segments: [
        { kind: "line", to: [10, 0] },
        { kind: "line", to: [0, 10] },
        { kind: "line", to: [0.0002, -0.0003] },
      ],
      closed: true,
    };
    const points = flattenPath(path);
    expect(points).toHaveLength(4);
    expect(points.at(-1)).toEqual([0, 0]);
  });

  it("turns a path without segments into a single point", () => {
    expect(flattenPath({ start: [5, 5], segments: [], closed: false })).toEqual([[5, 5]]);
  });

  it("flattens a full circle within the chord tolerance", () => {
    const tolerance = 0.05;
    const center: Point = [50, 50];
    const points = flattenPath(
      {
        start: [60, 50],
        segments: [{ kind: "arc", to: [60, 50], center, clockwise: false }],
        closed: true,
      },
      tolerance,
    );
    expect(points.at(-1)).toEqual([60, 50]);
    expect(points.length).toBeGreaterThan(10);
    for (const [i, point] of points.entries()) {
      expect(distance(point, center)).toBeCloseTo(10, 9);
      const next = points[i + 1];
      if (!next) continue;
      const mid: Point = [(point[0] + next[0]) / 2, (point[1] + next[1]) / 2];
      expect(10 - distance(mid, center)).toBeLessThanOrEqual(tolerance);
    }
  });

  it("sweeps arcs in their direction", () => {
    const arc = (clockwise: boolean): Path => ({
      start: [10, 0],
      segments: [{ kind: "arc", to: [0, 10], center: [0, 0], clockwise }],
      closed: false,
    });
    const quarter = flattenPath(arc(false));
    const threeQuarters = flattenPath(arc(true));
    expect(quarter.every(([x, y]) => x >= -1e-9 && y >= -1e-9)).toBe(true);
    expect(threeQuarters.some(([x, y]) => x < 0 && y < 0)).toBe(true);
    expect(threeQuarters.length).toBeGreaterThan(quarter.length);
  });

  it("flattens a cubic within the chord tolerance", () => {
    const tolerance = 0.01;
    const [p0, p1, p2, p3]: Point[] = [
      [0, 0],
      [0, 100],
      [100, 100],
      [100, 0],
    ] as const;
    const points = flattenPath(
      { start: p0, segments: [{ kind: "cubic", c1: p1, c2: p2, to: p3 }], closed: false },
      tolerance,
    );
    const bezier = (t: number): Point => {
      const u = 1 - t;
      const [a, b, c, d] = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
      return [
        a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
        a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1],
      ];
    };
    const steps = points.length - 1;
    expect(points.at(-1)).toEqual(p3);
    for (let i = 0; i < steps; i++) {
      const [from, to] = [points[i] as Point, points[i + 1] as Point];
      const mid: Point = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
      expect(distance(mid, bezier((i + 0.5) / steps))).toBeLessThanOrEqual(tolerance);
    }
  });

  it("rejects a tolerance that isn't positive", () => {
    expect(() => flattenPath({ start: [0, 0], segments: [], closed: false }, 0)).toThrow(
      RangeError,
    );
  });
});
