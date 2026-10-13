import { type Heightmap, MAX_HEIGHTMAP_CELLS } from "@furrow/cam-core";

/**
 * Width of the float texture that holds a heightmap's heights, row after row
 * of cells wrapped onto texture rows: 2048, the largest every WebGL 2 device
 * supports.
 */
export const TEXTURE_WIDTH = 2048;

/**
 * Most cells a heightmap drawn on a device whose textures are at most
 * `maxTextureSize` texels tall may have: as many rows of `TEXTURE_WIDTH` as
 * fit, up to `MAX_HEIGHTMAP_CELLS`.
 */
export function heightmapCellLimit(maxTextureSize: number): number {
  return Math.min(TEXTURE_WIDTH * Math.max(maxTextureSize, TEXTURE_WIDTH), MAX_HEIGHTMAP_CELLS);
}

let maxTextureSize: number | undefined;

/**
 * `heightmapCellLimit` for this browser's WebGL 2, asked once of a throwaway
 * context; 2048 texels, the least WebGL 2 guarantees, if it can't tell.
 */
export function deviceHeightmapCellLimit(): number {
  if (maxTextureSize === undefined) {
    const gl = document.createElement("canvas").getContext("webgl2");
    maxTextureSize = gl?.getParameter(gl.MAX_TEXTURE_SIZE) ?? TEXTURE_WIDTH;
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  }
  return heightmapCellLimit(maxTextureSize ?? TEXTURE_WIDTH);
}

/** `heights` padded to whole texture rows of `TEXTURE_WIDTH`. */
export function simulationTexture(heights: Float32Array): { data: Float32Array; height: number } {
  const height = Math.max(1, Math.ceil(heights.length / TEXTURE_WIDTH));
  const data = new Float32Array(TEXTURE_WIDTH * height);
  data.set(heights);
  return { data, height };
}

/**
 * The stock's sides under a heightmap, as triangle positions: from its
 * surface along each edge (outer cells reach the edge, as the surface does)
 * down to the bottom at `-thickness`.
 */
export function skirtPositions(
  { columns, rows, cellWidth, cellHeight, heights }: Heightmap,
  thickness: number,
): Float32Array {
  const width = columns * cellWidth;
  const height = rows * cellHeight;
  const along = (index: number, count: number, size: number) =>
    index === 0 ? 0 : index === count - 1 ? count * size : (index + 0.5) * size;
  const z = (column: number, row: number) => heights[row * columns + column] as number;
  const edges: [number, number, number][][] = [
    Array.from({ length: columns }, (_, c) => [along(c, columns, cellWidth), 0, z(c, 0)]),
    Array.from({ length: columns }, (_, c) => [
      along(c, columns, cellWidth),
      height,
      z(c, rows - 1),
    ]),
    Array.from({ length: rows }, (_, r) => [0, along(r, rows, cellHeight), z(0, r)]),
    Array.from({ length: rows }, (_, r) => [width, along(r, rows, cellHeight), z(columns - 1, r)]),
  ];
  const positions: number[] = [];
  const bottom = -thickness;
  for (const edge of edges) {
    for (let i = 1; i < edge.length; i++) {
      const [ax, ay, az] = edge[i - 1] as [number, number, number];
      const [bx, by, bz] = edge[i] as [number, number, number];
      positions.push(ax, ay, az, bx, by, bz, bx, by, bottom);
      positions.push(ax, ay, az, bx, by, bottom, ax, ay, bottom);
    }
  }
  return new Float32Array(positions);
}
