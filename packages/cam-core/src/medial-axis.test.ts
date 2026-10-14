import { distance, type Path, type Point } from "@furrow/document";
import { describe, expect, it } from "vitest";
import { DEFAULT_CHORD_TOLERANCE, flattenPath } from "./flatten";
import { containment, type Polygon } from "./geometry";
import { type MedialAxisBranch, medialAxis } from "./medial-axis";

const rect = (x: number, y: number, w: number, h: number): Polygon => [
  [x, y],
  [x + w, y],
  [x + w, y + h],
  [x, y + h],
];

const polar = (r: number, angle: number): Point => [r * Math.cos(angle), r * Math.sin(angle)];

const circle = (r: number, clockwise = false): Polygon =>
  flattenPath({
    start: [r, 0],
    closed: true,
    segments: [{ kind: "arc", to: [r, 0], center: [0, 0], clockwise }],
  });

/** A letter C: arcs between radii 12 and 20 with square 90° ends. */
const letterC = (): Polygon =>
  flattenPath({
    start: polar(20, Math.PI / 4),
    closed: true,
    segments: [
      { kind: "arc", to: polar(20, (7 * Math.PI) / 4), center: [0, 0], clockwise: false },
      { kind: "line", to: polar(12, (7 * Math.PI) / 4) },
      { kind: "arc", to: polar(12, Math.PI / 4), center: [0, 0], clockwise: true },
    ],
  });

/** A stroke like a letter S, bounded by cubic Béziers. */
const letterS = (): Polygon =>
  flattenPath({
    start: [-15, -18],
    closed: true,
    segments: [
      { kind: "cubic", c1: [10, -26], c2: [25, -8], to: [2, -2] },
      { kind: "cubic", c1: [-20, 4], c2: [-8, 22], to: [15, 16] },
      { kind: "line", to: [15, 22] },
      { kind: "cubic", c1: [-16, 30], c2: [-30, 4], to: [-4, 3] },
      { kind: "cubic", c1: [16, -2], c2: [4, -20], to: [-15, -12] },
    ],
  } satisfies Path);

/** A five-pointed star with 36° points. */
const star: Polygon = Array.from({ length: 10 }, (_, i) =>
  polar(i % 2 ? 9 : 22, Math.PI / 2 + (i * Math.PI) / 5),
);

/** A letter E: straight strokes 6 mm wide with convex and reflex 90° corners. */
const letterE: Polygon = [
  [-12, -20],
  [12, -20],
  [12, -14],
  [-6, -14],
  [-6, -3],
  [8, -3],
  [8, 3],
  [-6, 3],
  [-6, 14],
  [12, 14],
  [12, 20],
  [-12, 20],
];

/** Exact distance from `point` to the nearest edge of `rings`. */
function edgeDistance(rings: Polygon[], [x, y]: Point): number {
  let nearest = Number.POSITIVE_INFINITY;
  for (const ring of rings) {
    ring.forEach(([ax, ay], i) => {
      const [bx, by] = ring[(i + 1) % ring.length] as Point;
      const dx = bx - ax;
      const dy = by - ay;
      const length2 = dx * dx + dy * dy;
      const t = length2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / length2)) : 0;
      nearest = Math.min(nearest, Math.hypot(x - ax - t * dx, y - ay - t * dy));
    });
  }
  return nearest;
}

const nodes = (axis: MedialAxisBranch[]) =>
  axis.flatMap((branch) => branch.points.map((point, i) => ({ point, radius: branch.radii[i] })));

/** Branch ends with radius 0: the corners the axis reaches. */
const tips = (axis: MedialAxisBranch[]) =>
  nodes(axis)
    .filter(({ radius }) => radius === 0)
    .map(({ point }) => point);

/**
 * The largest distance by which a point of the shape, sampled every `step`
 * millimetres, lies outside every disk on the axis: the material a V-bit
 * following it would leave behind.
 */
function uncarved(rings: Polygon[], axis: MedialAxisBranch[], step: number): number {
  const disks = nodes(axis);
  const xs = rings.flat().map(([x]) => x);
  const ys = rings.flat().map(([, y]) => y);
  let worst = 0;
  for (let y = Math.min(...ys) + step / 2; y < Math.max(...ys); y += step) {
    for (let x = Math.min(...xs) + step / 2; x < Math.max(...xs); x += step) {
      const inside = rings.filter((ring) => containment([x, y], ring) === "inside").length % 2;
      if (!inside) continue;
      let gap = Number.POSITIVE_INFINITY;
      for (const { point, radius = 0 } of disks)
        gap = Math.min(gap, distance(point, [x, y]) - radius);
      worst = Math.max(worst, gap);
    }
  }
  return worst;
}

describe("medialAxis", () => {
  it("finds the centre line and corner branches of a rectangle", () => {
    const axis = medialAxis([rect(0, 0, 100, 20)]);
    expect(axis).toHaveLength(5);
    const all = nodes(axis);
    expect(Math.max(...all.map(({ radius = 0 }) => radius))).toBeCloseTo(10, 9);
    // The centre line runs from (10, 10) to (90, 10) at radius 10.
    for (const end of [
      [10, 10],
      [90, 10],
    ] as Point[]) {
      expect(all.some(({ point, radius }) => distance(point, end) < 1e-6 && radius === 10)).toBe(
        true,
      );
    }
    expect(tips(axis).sort((a, b) => a[0] - b[0] || a[1] - b[1])).toEqual([
      [0, 0],
      [0, 20],
      [100, 0],
      [100, 20],
    ]);
  });

  it("gives the ring of a letter O one closed branch", () => {
    const rings = [circle(20), circle(12, true)];
    const axis = medialAxis(rings);
    expect(axis).toHaveLength(1);
    const [branch] = axis;
    expect(branch?.points[0]).toEqual(branch?.points.at(-1));
    // Each flattened ring lies up to the chord tolerance inside its circle.
    for (const { point, radius = 0 } of nodes(axis)) {
      expect(Math.abs(Math.hypot(...point) - 16)).toBeLessThan(2 * DEFAULT_CHORD_TOLERANCE);
      expect(Math.abs(radius - 4)).toBeLessThan(2 * DEFAULT_CHORD_TOLERANCE);
    }
  });

  it("reaches into sharp convex corners but not reflex ones", () => {
    const starTips = tips(medialAxis([star]));
    expect(starTips).toHaveLength(5);
    for (const tip of starTips) expect(Math.hypot(...tip)).toBeCloseTo(22, 3);
    // The E's eight convex corners, none of its four reflex ones.
    const eTips = tips(medialAxis([letterE]));
    expect(eTips).toHaveLength(8);
    for (const tip of eTips) expect(Math.abs(tip[0]) === 12 || tip[0] === 8).toBe(true);
  });

  it("drops spurs into the vertices of flattened curves", () => {
    // Only the C's four square corners are tips, not the hundreds of arc vertices.
    expect(tips(medialAxis([letterC()]))).toHaveLength(4);
  });

  it("never goes deeper than the edges allow and leaves almost nothing behind", () => {
    for (const rings of [[letterC()], [letterS()], [star], [circle(20), circle(12, true)]]) {
      const axis = medialAxis(rings);
      for (const { point, radius = 0 } of nodes(axis)) {
        expect(radius).toBeLessThanOrEqual(edgeDistance(rings, point) + 1e-4);
      }
      expect(uncarved(rings, axis, 0.25)).toBeLessThan(0.05);
    }
  });

  it("combines rings with the fill rule", () => {
    // Both rings counter-clockwise: a hole only with even-odd. The frame is widest on
    // its diagonals, where the disk touches two outer edges and the hole's corner.
    const rings = [rect(0, 0, 40, 40), rect(10, 10, 20, 20)];
    const max = (axis: MedialAxisBranch[]) =>
      Math.max(...nodes(axis).map(({ radius = 0 }) => radius));
    expect(max(medialAxis(rings))).toBeCloseTo(20, 9);
    expect(max(medialAxis(rings, { fillRule: "evenOdd" }))).toBeCloseTo(10 * (2 - Math.SQRT2), 3);
  });

  it("returns nothing for empty or degenerate input", () => {
    expect(medialAxis([])).toEqual([]);
    expect(
      medialAxis([
        [
          [0, 0],
          [10, 0],
        ],
      ]),
    ).toEqual([]);
  });

  it("rejects a sample spacing that is not positive", () => {
    expect(() => medialAxis([rect(0, 0, 10, 10)], { spacing: 0 })).toThrow(RangeError);
  });
});
