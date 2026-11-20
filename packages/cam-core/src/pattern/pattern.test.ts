import {
  LINE_PATTERN_CELLS,
  type Path,
  PatternCell,
  type PatternSettings,
  type Point,
} from "@furrow/document";
import { describe, expect, it } from "vitest";
import { containment, type Polygon, signedArea } from "../geometry/clipper";
import { flattenPath } from "../geometry/flatten";
import { polygonPath } from "../geometry/path";
import { PatternTooDenseError, patternPaths } from "./pattern";

const rect = (x: number, y: number, w: number, h: number): Polygon => [
  [x, y],
  [x + w, y],
  [x + w, y + h],
  [x, y + h],
];

const settings = (changes: Partial<PatternSettings> = {}): PatternSettings => ({
  cell: "square",
  size: 10,
  gap: 0,
  inset: 0,
  amplitude: 4,
  wavelength: 15,
  seed: 7,
  placement: { position: [0, 0], rotation: 0, mirrored: false },
  boundary: [{ shapeId: "00000000-0000-4000-8000-000000000000", paths: null }],
  ...changes,
});

/** A 100 × 80 mm frame with a 20 mm square hole in the middle. */
const frame = [polygonPath(rect(0, 0, 100, 80)), polygonPath(rect(40, 30, 20, 20))];

const points = (paths: Path[]) => paths.flatMap((path) => flattenPath(path));
const area = (paths: Path[]) =>
  paths.reduce((sum, path) => sum + Math.abs(signedArea(flattenPath(path))), 0);

/** Whether `point` is inside the frame, its hole left out, give or take a clipper unit. */
function inFrame([x, y]: Point): boolean {
  const e = 1e-3;
  if (x < -e || y < -e || x > 100 + e || y > 80 + e) return false;
  return containment([x, y], rect(40 + e, 30 + e, 20 - 2 * e, 20 - 2 * e)) === "outside";
}

describe("patternPaths", () => {
  it.each(PatternCell.options)("fills the frame with %s, inside it and its hole empty", (cell) => {
    const paths = patternPaths(frame, settings({ cell, gap: 1 }));
    expect(paths.length).toBeGreaterThanOrEqual(10);
    expect(points(paths).every(inFrame)).toBe(true);
    const line = LINE_PATTERN_CELLS.includes(cell);
    expect(paths.every((path) => path.closed === !line)).toBe(true);
  });

  it.each([
    "square",
    "brick",
    "hexagon",
    "triangle",
    "diamond",
    "herringbone",
    "basketWeave",
    "fishScale",
    "chevron",
    "voronoi",
  ] as const)("tiles %s cells with shared edges, covering the whole frame", (cell) => {
    const paths = patternPaths(frame, settings({ cell }));
    expect(area(paths) / (100 * 80 - 20 * 20)).toBeCloseTo(1, 3);
  });

  it("leaves the gap between cells", () => {
    const paths = patternPaths([polygonPath(rect(0, 0, 100, 80))], settings({ gap: 2 }));
    expect(paths).toHaveLength(80);
    expect(area(paths)).toBeCloseTo(80 * 64, 6);
    const hexagons = patternPaths(frame, settings({ cell: "hexagon", gap: 0 }));
    const apart = patternPaths(frame, settings({ cell: "hexagon", gap: 2 }));
    expect(area(apart)).toBeLessThan(area(hexagons) * 0.8);
  });

  it("stops the inset inside the boundary", () => {
    const paths = patternPaths(frame, settings({ inset: 5, cell: "crosshatch" }));
    for (const [x, y] of points(paths)) {
      expect(Math.min(x, y, 100 - x, 80 - y)).toBeGreaterThan(5 - 1e-3);
    }
    expect(patternPaths(frame, settings({ inset: 50 }))).toEqual([]);
  });

  it("ignores open paths, and is empty without a closed one", () => {
    const open = polygonPath(rect(0, 0, 500, 500), false);
    expect(patternPaths([open], settings())).toEqual([]);
    expect(patternPaths([...frame, open], settings())).toEqual(patternPaths(frame, settings()));
  });

  it("moves and turns with its placement, cells keeping their size", () => {
    const base = patternPaths(frame, settings({ cell: "hexagon", gap: 1 }));
    // The frame and the placement turned a quarter about (0, 0) and moved by (200, 0).
    const turn = ([x, y]: Point): Point => [200 - y, x];
    const turned = frame.map((path) => polygonPath(flattenPath(path).slice(0, -1).map(turn)));
    const moved = patternPaths(
      turned,
      settings({
        cell: "hexagon",
        gap: 1,
        placement: { position: [200, 0], rotation: 90, mirrored: false },
      }),
    );
    expect(moved).toHaveLength(base.length);
    expect(area(moved)).toBeCloseTo(area(base), 2);
    const key = ([x, y]: Point) => `${x.toFixed(2)},${y.toFixed(2)}`;
    const expected = new Set(points(base).map(turn).map(key));
    expect(points(moved).filter((p) => !expected.has(key(p)))).toEqual([]);
  });

  it("draws the same random cells from the same seed", () => {
    for (const cell of ["voronoi", "truchet"] as const) {
      expect(patternPaths(frame, settings({ cell }))).toEqual(
        patternPaths(frame, settings({ cell })),
      );
      expect(patternPaths(frame, settings({ cell, seed: 8 }))).not.toEqual(
        patternPaths(frame, settings({ cell })),
      );
    }
  });

  it("leaves out lines lying along the boundary's edges, outer or inner, keeping the rest", () => {
    const e = 1e-2;
    /** Whether `a` to `b` runs along an edge of the frame or its hole. */
    const along = ([a, b]: Point[]) => {
      if (!a || !b) return false;
      const [mx, my] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const near = (v: number, w: number) => Math.abs(v - w) < e;
      const flat = near(a[1], b[1]);
      const upright = near(a[0], b[0]);
      return (
        (flat &&
          (near(my, 0) ||
            near(my, 80) ||
            ((near(my, 30) || near(my, 50)) && mx > 40 && mx < 60))) ||
        (upright &&
          (near(mx, 0) || near(mx, 100) || ((near(mx, 40) || near(mx, 60)) && my > 30 && my < 50)))
      );
    };
    const segments = (paths: Path[]) =>
      paths.flatMap((path) => {
        const line = flattenPath(path);
        return line.slice(1).map((to, k) => [line[k] as Point, to]);
      });
    const lines = patternPaths(frame, settings({ cell: "lines" }));
    // y = 10, 20, 60 and 70 whole; 30, 40 and 50 either side of the hole.
    expect(lines).toHaveLength(10);
    expect(segments(lines).filter(along)).toEqual([]);
    const hatch = patternPaths(frame, settings({ cell: "crosshatch" }));
    // And x = 10 to 90, those at 40, 50 and 60 either side of the hole.
    expect(hatch).toHaveLength(10 + 12);
    expect(segments(hatch).filter(along)).toEqual([]);
  });

  it("winds every closed cell's outline counter-clockwise, mirrored or not, at rounded coordinates", () => {
    const box = [polygonPath(rect(0, 0, 100, 80))];
    for (const mirrored of [false, true]) {
      const placement = { position: [3, 4] as Point, rotation: 33, mirrored };
      const paths = patternPaths(box, settings({ size: 7, placement }));
      expect(paths.every((path) => signedArea(flattenPath(path)) > 0)).toBe(true);
      expect(
        points(paths).every(
          ([x, y]) => x === Math.round(x * 1e9) / 1e9 && y === Math.round(y * 1e9) / 1e9,
        ),
      ).toBe(true);
    }
  });

  it("covers the boundary with Voronoi cells whatever the seed", () => {
    for (let seed = 0; seed < 20; seed++) {
      const paths = patternPaths(frame, settings({ cell: "voronoi", seed }));
      expect(area(paths) / (100 * 80 - 20 * 20)).toBeCloseTo(1, 3);
    }
  });

  it("fills round a small hole in a large panel, where blocks lie wholly inside the outline", () => {
    const panel = [polygonPath(rect(0, 0, 400, 400)), polygonPath(rect(190, 190, 20, 20))];
    const paths = patternPaths(panel, settings({ size: 5 }));
    expect(area(paths)).toBeCloseTo(400 * 400 - 20 * 20, 6);
  });

  it("stays fast inside a boundary of many vertices", () => {
    const disk = Array.from(
      { length: 20_000 },
      (_, k): Point => [
        150 + 100 * Math.cos((2 * Math.PI * k) / 20_000),
        150 + 100 * Math.sin((2 * Math.PI * k) / 20_000),
      ],
    );
    const start = performance.now();
    const paths = patternPaths([polygonPath(disk)], settings({ cell: "hexagon", size: 2 }));
    expect(performance.now() - start).toBeLessThan(3000);
    expect(area(paths)).toBeCloseTo(Math.PI * 100 ** 2, -2);
  });

  it("refuses cells too small for the boundary", () => {
    expect(() => patternPaths(frame, settings({ size: 0.1 }))).toThrow(PatternTooDenseError);
    // Waves sampled too finely along their lines, though few.
    const panel = [polygonPath(rect(0, 0, 300, 200))];
    const fine = settings({ cell: "wave", size: 2, wavelength: 0.1 });
    expect(() => patternPaths(panel, fine)).toThrow(PatternTooDenseError);
  });

  it("fills 300 × 200 mm with 5 mm hexagons within the time budget (P7)", () => {
    const panel = [polygonPath(rect(0, 0, 300, 200))];
    const start = performance.now();
    const paths = patternPaths(panel, settings({ cell: "hexagon", size: 5, gap: 0.5 }));
    expect(performance.now() - start).toBeLessThan(2000);
    expect(paths.length).toBeGreaterThan(2500);
  });
});
