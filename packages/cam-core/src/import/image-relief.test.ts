import { describe, expect, it } from "vitest";
import { triangleBudget } from "./height-grid";
import {
  type ImageReliefSettings,
  imageHeights,
  imageReliefMesh,
  type ReliefImage,
  reliefCells,
  reliefPixels,
} from "./image-relief";
import { parseStl } from "./stl/import";

/** An image `width` × `height` whose pixel (x, y) is the grey `grey(x, y)`, opaque. */
function image(width: number, height: number, grey: (x: number, y: number) => number) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const k = (y * width + x) * 4;
      data.set([grey(x, y), grey(x, y), grey(x, y), 255], k);
    }
  }
  return { width, height, data } satisfies ReliefImage;
}

const SETTINGS: ImageReliefSettings = { width: 100, relief: 5, base: 2, invert: false, blur: 0 };
const LIMITS = { maxBytes: 50_000_000, maxTriangles: 20_000 };

/** Whether every directed edge appears once, and so does its reverse. */
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

describe("imageHeights", () => {
  it("reads luminance, transparent as black, and inverts", () => {
    const pixels = {
      width: 4,
      height: 1,
      data: [255, 255, 255, 255, 0, 0, 0, 255, 255, 0, 0, 255, 255, 255, 255, 0],
    };
    expect([...imageHeights(pixels, false, 0)].map((h) => +h.toFixed(4))).toEqual([
      1, 0, 0.2126, 0,
    ]);
    expect([...imageHeights(pixels, true, 0)].map((h) => +h.toFixed(4))).toEqual([0, 1, 0.7874, 1]);
  });

  it("box-blurs, repeating the edge pixels", () => {
    const step = image(5, 1, (x) => (x < 2 ? 0 : 255));
    const blurred = imageHeights(step, false, 1);
    expect([...blurred].map((h) => +h.toFixed(4))).toEqual([0, 0.3333, 0.6667, 1, 1]);
  });
});

describe("reliefCells", () => {
  it("never has more corners than pixels", () => {
    expect(reliefCells(30, 20, 1_000_000)).toEqual([29, 19]);
  });

  it("keeps the aspect ratio and fits the budget", () => {
    const [nx, ny] = reliefCells(4000, 1000, 20_000);
    expect(nx / ny).toBeCloseTo(4, 0);
    expect(2 * nx * ny + 6 * (nx + ny) + 2).toBeLessThanOrEqual(20_000);
    const [tall, long] = reliefCells(1000, 4000, 20_000);
    expect([tall, long]).toEqual([ny, nx]);
  });

  it("refuses an image under 2 × 2 pixels", () => {
    expect(() => reliefCells(1, 10, 1000)).toThrow(/image.tooSmall/);
  });
});

describe("reliefPixels", () => {
  it("shrinks a large image to two pixels a cell, keeping its aspect", () => {
    const [nx] = reliefCells(6000, 4000, triangleBudget(LIMITS));
    const [width, height] = reliefPixels(6000, 4000, LIMITS);
    expect(width).toBe(2 * nx + 1);
    expect(height).toBe(Math.round((4000 * width) / 6000));
    // The shrunk image still gives the grid it was shrunk for.
    expect(reliefCells(width, height, triangleBudget(LIMITS))[0]).toBe(nx);
  });

  it("leaves an image smaller than that as it is", () => {
    expect(reliefPixels(40, 20, LIMITS)).toEqual([40, 20]);
  });
});

describe("imageReliefMesh", () => {
  it("makes a closed mesh, white high, its top row at the back", () => {
    // Black at the top row of the image, white at the bottom.
    const result = imageReliefMesh(
      image(40, 20, (_, y) => (y < 10 ? 0 : 255)),
      SETTINGS,
      LIMITS,
    );
    expect(closed(result.stl)).toBe(true);
    expect(result.cells).toEqual([39, 19]);
    expect(result.size).toEqual([100, 50, 7]);
    const { positions, triangles, bounds } = parseStl(result.stl);
    expect(triangles).toBe(result.triangles);
    expect(bounds.min).toEqual([0, 0, 0]);
    expect(bounds.max[0]).toBeCloseTo(100);
    expect(bounds.max[1]).toBeCloseTo(50);
    // Front (y = 0) is white: base + relief; back is black: the base.
    for (let k = 0; k < positions.length; k += 3) {
      if (positions[k + 2] === 0) continue;
      const y = positions[k + 1] as number;
      if (y < 1) expect(positions[k + 2]).toBeCloseTo(7);
      if (y > 49) expect(positions[k + 2]).toBeCloseTo(2);
    }
  });

  it("stays within the limits for a large image", () => {
    const result = imageReliefMesh(
      image(600, 400, (x, y) => (x * y) % 256),
      { ...SETTINGS, invert: true, blur: 2 },
      LIMITS,
    );
    expect(result.triangles).toBeLessThanOrEqual(triangleBudget(LIMITS));
    expect(closed(result.stl)).toBe(true);
    expect(result.size[1]).toBeCloseTo(100 * (400 / 600));
  });
});
