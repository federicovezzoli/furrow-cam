import { describe, expect, it } from "vitest";
import { DEFAULT_STL_LIMITS, parseStl } from "../stl/import";
import { MAX_TERRAIN_SPAN, planTerrain, terrainMesh } from "./mesh";
import {
  decodeTerrarium,
  elevationSampler,
  type LonLat,
  type TerrainTile,
  type TileKey,
} from "./tiles";

/** Degrees of latitude per metre, near enough for building test areas. */
const PER_METRE = 1 / 111_195;
const CENTRE: LonLat = [9.4, 45.9];

/** A rectangle `width` × `depth` metres around `CENTRE`. */
function rectangle(width: number, depth: number): LonLat[] {
  const dx = (width / 2) * (PER_METRE / Math.cos((CENTRE[1] * Math.PI) / 180));
  const dy = (depth / 2) * PER_METRE;
  const [lon, lat] = CENTRE;
  return [
    [lon - dx, lat - dy],
    [lon + dx, lat - dy],
    [lon + dx, lat + dy],
    [lon - dx, lat + dy],
  ];
}

/** An ellipse of `points` points with radii `rx` × `ry` metres around `CENTRE`. */
function ellipse(rx: number, ry: number, points = 64): LonLat[] {
  const kx = PER_METRE / Math.cos((CENTRE[1] * Math.PI) / 180);
  return Array.from({ length: points }, (_, k): LonLat => {
    const angle = (2 * Math.PI * k) / points;
    return [CENTRE[0] + rx * Math.cos(angle) * kx, CENTRE[1] + ry * Math.sin(angle) * PER_METRE];
  });
}

/** A cone 800 m tall over a 200 m plain, its peak at `CENTRE`. */
function cone([lon, lat]: LonLat): number {
  const dx = (lon - CENTRE[0]) * Math.cos((CENTRE[1] * Math.PI) / 180);
  const distance = Math.hypot(dx, lat - CENTRE[1]) / PER_METRE;
  return Math.max(200, 1000 - distance * 0.5);
}

/** `keys` as `size`-pixel tiles of `height`, sampled at each pixel's centre. */
function tilesOf(keys: readonly TileKey[], height: (place: LonLat) => number, size = 64) {
  return keys.map(({ z, x, y }): TerrainTile => {
    const heights = new Float32Array(size * size);
    const count = 2 ** z;
    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        const mx = (x + (i + 0.5) / size) / count;
        const my = (y + (j + 0.5) / size) / count;
        const lat = (Math.atan(Math.sinh(Math.PI * (1 - 2 * my))) * 180) / Math.PI;
        heights[j * size + i] = height([mx * 360 - 180, lat]);
      }
    }
    return { z, x, y, heights };
  });
}

/**
 * Whether the mesh is closed and consistently wound: every directed edge
 * appears once, and so does its reverse.
 */
function closed(stl: Uint8Array): boolean {
  const { positions, triangles } = parseStl(stl);
  const key = (k: number) => `${positions[k * 3]},${positions[k * 3 + 1]},${positions[k * 3 + 2]}`;
  const edges = new Map<string, number>();
  for (let t = 0; t < triangles; t++) {
    for (let m = 0; m < 3; m++) {
      const edge = `${key(t * 3 + m)}>${key(t * 3 + ((m + 1) % 3))}`;
      edges.set(edge, (edges.get(edge) ?? 0) + 1);
    }
  }
  for (const [edge, count] of edges) {
    const [from, to] = edge.split(">");
    if (count !== 1 || edges.get(`${to}>${from}`) !== 1) return false;
  }
  return true;
}

const SETTINGS = { longestSide: 200, exaggeration: 1.5, base: 3 };
const SMALL = { maxBytes: 50_000_000, maxTriangles: 20_000 };

function terrain(ring: LonLat[], limits = SMALL) {
  const plan = planTerrain(ring, limits, 14);
  return terrainMesh(ring, plan, SETTINGS, tilesOf(plan.tiles, cone));
}

describe("decodeTerrarium", () => {
  it("decodes R × 256 + G + B / 256 − 32768", () => {
    expect([...decodeTerrarium([128, 0, 0, 255, 131, 232, 128, 255, 127, 255, 0, 255])]).toEqual([
      0, 1000.5, -1,
    ]);
  });
});

describe("elevationSampler", () => {
  it("falls back to the parent tile where the deeper one is missing", () => {
    const tiles = [
      ...tilesOf([{ z: 1, x: 1, y: 0 }], () => 100),
      ...tilesOf([{ z: 2, x: 2, y: 0 }], () => 300),
    ];
    const at = elevationSampler(tiles);
    // In z2's tile 2/2/0, then in 2/3/0, which is missing, so 1/1/0.
    expect(at([10, 80])).toBeCloseTo(300);
    expect(at([150, 80])).toBeCloseTo(100);
    expect(at([-90, 80])).toBeNaN();
  });

  it("reads across into the next tile at its edge, without a seam", () => {
    const tiles = [
      ...tilesOf([{ z: 2, x: 2, y: 1 }], () => 100),
      ...tilesOf([{ z: 2, x: 3, y: 1 }], () => 300),
    ];
    const at = elevationSampler(tiles);
    // Exactly on the edge between the two tiles: halfway between their edge pixels.
    expect(at([90, 30])).toBeCloseTo(200);
    // More than half a pixel (1.4° wide here) in, only its own tile counts.
    expect(at([88, 30])).toBeCloseTo(100);
  });
});

describe("planTerrain", () => {
  it("fits about 700 × 700 cells in the default limits", () => {
    const plan = planTerrain(rectangle(10_000, 10_000), DEFAULT_STL_LIMITS, 14);
    expect(plan.cells).toBeGreaterThan(650);
    expect(plan.cells).toBeLessThan(710);
    expect(plan.cellMetres).toBeCloseTo(10_000 / plan.cells);
    expect(plan.tiles.length).toBeGreaterThan(0);
    expect(new Set(plan.tiles.map(({ z }) => z))).toEqual(new Set([plan.tiles[0]?.z]));
  });

  it("refuses an area across the 180° meridian", () => {
    const ring: LonLat[] = [
      [179.99, -17],
      [-179.99, -17],
      [-179.99, -16.99],
      [179.99, -16.99],
    ];
    expect(() => planTerrain(ring, SMALL, 14)).toThrow(/terrain.antimeridian/);
  });

  it("refuses an area wider than the limit", () => {
    expect(() => planTerrain(rectangle(MAX_TERRAIN_SPAN * 1.1, 1000), SMALL, 14)).toThrow(
      /terrain.tooWide/,
    );
  });
});

describe("terrainMesh", () => {
  it("makes a closed mesh of a rectangle, sized and within the limits", () => {
    const result = terrain(rectangle(4000, 2000));
    expect(closed(result.stl)).toBe(true);
    expect(result.triangles).toBeLessThanOrEqual(SMALL.maxTriangles);
    expect(result.size[0]).toBeCloseTo(200, 0);
    expect(result.size[1]).toBeGreaterThan(98);
    expect(result.size[1]).toBeLessThan(105);
    const [low, high] = result.heights;
    expect(low).toBeCloseTo(200, -1);
    expect(high).toBeGreaterThan(950);
    // Relief at 200 mm for 4 km, exaggerated, on the base.
    expect(result.size[2]).toBeCloseTo((high - low) * (200 / 4000) * 1.5 + 3, 3);
    expect(result.outline).toHaveLength(4);
  });

  it("makes a closed mesh of an ellipse and keeps its outline", () => {
    const result = terrain(ellipse(2000, 1200));
    expect(closed(result.stl)).toBe(true);
    expect(result.triangles).toBeLessThanOrEqual(SMALL.maxTriangles);
    expect(result.outline).toHaveLength(64);
    // The mesh starts at the origin, and its size is its extent.
    const { bounds } = parseStl(result.stl);
    expect(bounds.min[0]).toBeCloseTo(0);
    expect(bounds.min[1]).toBeCloseTo(0);
    expect(bounds.max[0]).toBeCloseTo(result.size[0]);
    expect(bounds.max[1]).toBeCloseTo(result.size[1]);
    for (const [x, y] of result.outline) {
      expect(x).toBeGreaterThan(-result.size[0] / 100);
      expect(y).toBeGreaterThan(-result.size[1] / 100);
    }
  });

  it("drops cells that touch only at a corner", () => {
    // Two squares sharing only a corner, drawn as one figure-eight stroke.
    // With an even number of cells the corner is a grid vertex, so the two
    // cells there touch only at it; the budgets give both even and odd grids.
    const [lon, lat] = CENTRE;
    const l = 1000 * PER_METRE;
    const eight: LonLat[] = [
      [lon - l, lat - l],
      [lon, lat - l],
      [lon, lat],
      [lon + l, lat],
      [lon + l, lat + l],
      [lon, lat + l],
      [lon, lat],
      [lon - l, lat],
    ];
    for (const maxTriangles of [2000, 2200, 2400, 2600]) {
      const result = terrain(eight, { maxBytes: 50_000_000, maxTriangles });
      expect(closed(result.stl)).toBe(true);
    }
  });

  it("closes a ring around a hole", () => {
    // An annulus drawn as one stroke: around the outside, in along a cut of
    // no width, around the inside the other way, and back out.
    const outer = ellipse(2000, 2000, 96);
    const inner = ellipse(1000, 1000, 96);
    const ring = [...outer, outer[0], inner[0], ...[...inner].reverse(), inner[0]] as LonLat[];
    const result = terrain(ring);
    expect(closed(result.stl)).toBe(true);
  });

  it("shrinks the grid until the mesh fits", () => {
    const limits = { maxBytes: 50_000_000, maxTriangles: 3000 };
    const result = terrain(ellipse(2000, 1200, 200), limits);
    expect(result.triangles).toBeLessThanOrEqual(3000);
    expect(closed(result.stl)).toBe(true);
  });

  it("refuses an area no tile covers", () => {
    const ring = rectangle(1000, 1000);
    expect(() => terrainMesh(ring, planTerrain(ring, SMALL, 14), SETTINGS, [])).toThrow(
      /terrain.noData/,
    );
  });
});
