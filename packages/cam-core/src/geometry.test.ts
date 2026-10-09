import { distance, type Point } from "@furrow/document";
import { describe, expect, it } from "vitest";
import {
  containment,
  difference,
  intersection,
  nest,
  offset,
  type Polygon,
  signedArea,
  union,
} from "./geometry";

const rect = (x: number, y: number, w: number, h: number): Polygon => [
  [x, y],
  [x + w, y],
  [x + w, y + h],
  [x, y + h],
];

/** The one polygon in `polygons`. */
function single(polygons: Polygon[]): Polygon {
  expect(polygons).toHaveLength(1);
  return polygons[0] ?? [];
}

const totalArea = (polygons: Polygon[]) => polygons.reduce((sum, p) => sum + signedArea(p), 0);

/** Two 50 mm squares sharing the corner (50, 50), drawn as one ring that visits it twice. */
const selfTouching: Polygon = [
  [0, 0],
  [50, 0],
  [50, 50],
  [100, 50],
  [100, 100],
  [50, 100],
  [50, 50],
  [0, 50],
];

describe("offset", () => {
  it("shrinks an outer boundary and grows its hole", () => {
    const result = offset([rect(0, 0, 100, 100), rect(30, 30, 40, 40).reverse()], -3);
    expect(result).toHaveLength(2);
    // 94² outer minus the hole grown by 3 mm with round corners.
    const expected = 94 * 94 - (46 * 46 - (4 - Math.PI) * 9);
    expect(totalArea(result)).toBeCloseTo(expected, 0);
    // Round joins are polygons inside the true arc, so the hole is never too small.
    expect(totalArea(result)).toBeGreaterThan(expected);
  });

  it("keeps a sharp corner sharp with a miter join", () => {
    const square = single(offset([rect(0, 0, 10, 10)], 1, { join: "miter" }));
    expect(signedArea(square)).toBeCloseTo(144, 6);
  });

  it("splits a self-touching ring into its two lobes when shrinking", () => {
    const result = offset([selfTouching], -2);
    expect(result).toHaveLength(2);
    expect(totalArea(result)).toBeCloseTo(2 * 46 * 46, 6);
  });

  it("merges a self-touching ring into one shape when growing", () => {
    expect(offset([selfTouching], 2)).toHaveLength(1);
  });

  it("splits a shape at a neck narrower than twice the offset", () => {
    const dumbbell = union([rect(0, 0, 40, 40), rect(60, 0, 40, 40), rect(40, 18, 20, 4)]);
    expect(dumbbell).toHaveLength(1);
    expect(offset(dumbbell, -1)).toHaveLength(1);
    expect(offset(dumbbell, -3)).toHaveLength(2);
  });

  it("returns nothing once a shape has shrunk away", () => {
    expect(offset([rect(0, 0, 10, 10)], -5.1)).toEqual([]);
  });

  it("keeps round joins within the arc tolerance", () => {
    const square = single(offset([rect(0, 0, 10, 10)], 5, { arcTolerance: 0.001 }));
    // Every vertex lies on a corner arc of radius 5.
    const corners: Point[] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ];
    for (const [x, y] of square) {
      const radius = Math.min(...corners.map(([cx, cy]) => Math.hypot(x - cx, y - cy)));
      expect(radius).toBeCloseTo(5, 3);
    }
    // Arc chords (the short edges) bulge at most the tolerance from the arc.
    const chords = square
      .map((p, i) => distance(p, square[(i + 1) % square.length] ?? p))
      .filter((length) => length < 5);
    expect(chords.length).toBeGreaterThan(4);
    for (const length of chords) {
      expect(5 - Math.sqrt(25 - (length / 2) ** 2)).toBeLessThanOrEqual(0.001 + 1e-4);
    }
    expect(() => offset([rect(0, 0, 10, 10)], 1, { arcTolerance: 0 })).toThrow(RangeError);
  });
});

describe("booleans", () => {
  it("unions overlapping shapes", () => {
    expect(totalArea(union([rect(0, 0, 10, 10), rect(5, 5, 10, 10)]))).toBeCloseTo(175, 6);
  });

  it("resolves a self-intersecting bow tie into two triangles", () => {
    const bowTie: Polygon = [
      [0, 0],
      [100, 100],
      [100, 0],
      [0, 100],
    ];
    const result = union([bowTie]);
    expect(result).toHaveLength(2);
    expect(result.every((p) => signedArea(p) > 0)).toBe(true);
    expect(totalArea(result)).toBeCloseTo(5000, 6);
  });

  it("cuts an island out of a region as a clockwise hole", () => {
    const result = difference([rect(0, 0, 100, 100)], [rect(40, 40, 20, 20)]);
    expect(result).toHaveLength(2);
    expect(result.map(signedArea).sort((a, b) => a - b)).toEqual([-400, 10000]);
  });

  it("intersects shapes", () => {
    expect(totalArea(intersection([rect(0, 0, 10, 10)], [rect(5, 5, 10, 10)]))).toBeCloseTo(25, 6);
  });

  it("keeps sub-micron coordinates to 0.0001 mm", () => {
    const square = single(union([rect(0.12345, 0, 1, 1)]));
    expect(Math.min(...square.map(([x]) => x))).toBeCloseTo(0.1235, 9);
  });
});

describe("nest", () => {
  it("pairs holes and islands with their outer boundary whatever the winding", () => {
    // All counter-clockwise, as an imported drawing might be.
    const result = nest([rect(0, 0, 100, 100), rect(10, 10, 80, 80), rect(30, 30, 40, 40)]);
    const areas = result
      .map(({ outer, holes }) => ({ outer: signedArea(outer), holes: holes.map(signedArea) }))
      .sort((a, b) => a.outer - b.outer);
    expect(areas).toEqual([
      { outer: 1600, holes: [] },
      { outer: 10000, holes: [-6400] },
    ]);
  });
});

describe("containment", () => {
  const square = rect(0, 0, 100, 100);

  it("classifies points inside, outside and on the boundary", () => {
    expect(containment([50, 50], square)).toBe("inside");
    expect(containment([150, 50], square)).toBe("outside");
    expect(containment([100, 50], square)).toBe("on");
  });

  it("accepts a ring that repeats its first point", () => {
    expect(containment([50, 50], [...square, [0, 0]])).toBe("inside");
  });
});

describe("signedArea", () => {
  it("is positive counter-clockwise and negative clockwise", () => {
    expect(signedArea(rect(0, 0, 2, 3))).toBe(6);
    expect(signedArea(rect(0, 0, 2, 3).reverse())).toBe(-6);
  });
});
