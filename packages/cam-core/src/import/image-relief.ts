import { MessageError } from "@furrow/document";
import { heightGridMesh, triangleBudget } from "./height-grid";
import type { ImportMessage } from "./messages";
import { type StlLimits, writeBinaryStl } from "./stl/import";

// A relief from a greyscale image, as a closed mesh (PRD-0015, ADR-0077).

/** Why an image can't become a relief, for the user (ADR-0054). */
export class ImageReliefError extends MessageError<ImportMessage> {}

/** An image's pixels, RGBA row by row from the top, as `ImageData` holds them. */
export type ReliefImage = { width: number; height: number; data: ArrayLike<number> };

/** The relief's size and shape, chosen by the user (PRD-0015 I2). */
export type ImageReliefSettings = {
  /** The model's width, in mm; its depth follows the image's aspect ratio. */
  width: number;
  /** How much higher white is than black, in mm. */
  relief: number;
  /** The model's thickness under black, in mm. */
  base: number;
  /** Dark is high instead of light. */
  invert: boolean;
  /** The box blur's radius against pixel noise, in image pixels; 0 for none. */
  blur: number;
};

/** The settings' ranges and defaults, in mm and pixels (PRD-0015 I2). */
export const IMAGE_RELIEF = {
  relief: { min: 0.1, initial: 5 },
  base: { min: 1, initial: 3 },
  blur: { min: 0, max: 50, initial: 0 },
};

/** A relief model: a closed binary STL in mm, its lowest corner at (0, 0, 0). */
export type ImageRelief = {
  stl: Uint8Array<ArrayBuffer>;
  triangles: number;
  /** Width, depth and height, in mm. */
  size: [number, number, number];
  /** Cells across and along: never more corners than the image has pixels. */
  cells: [number, number];
};

/**
 * The image's heights from 0 to 1, row by row from the top, at `size`
 * pixels (its own by default; a smaller size averages the pixels falling in
 * each): each pixel's luminance (Rec. 709 on the sRGB values), transparent
 * counting as black, inverted with `invert`, then box-blurred `blur` of the
 * image's own pixels around.
 */
export function imageHeights(
  { width, height, data }: ReliefImage,
  invert: boolean,
  blur: number,
  [columns, rows]: readonly [number, number] = [width, height],
) {
  const sums = new Float32Array(columns * rows);
  const counts = new Uint32Array(columns * rows);
  for (let y = 0; y < height; y++) {
    const row = Math.floor((y * rows) / height) * columns;
    for (let x = 0; x < width; x++) {
      const k = (y * width + x) * 4;
      const luminance =
        (0.2126 * (data[k] as number) +
          0.7152 * (data[k + 1] as number) +
          0.0722 * (data[k + 2] as number)) /
        255;
      const value = (luminance * (data[k + 3] as number)) / 255;
      const target = row + Math.floor((x * columns) / width);
      sums[target] = (sums[target] as number) + (invert ? 1 - value : value);
      counts[target] = (counts[target] as number) + 1;
    }
  }
  const heights = sums.map((sum, p) => sum / (counts[p] as number));
  return boxBlur(heights, columns, rows, (blur * columns) / width);
}

/**
 * `values` averaged over a (2r + 1)² square about each pixel, the edge pixels
 * repeated beyond it. A fractional `r` counts the pixels at the square's edge
 * in part, so the blur grows smoothly with it.
 */
function boxBlur(values: Float32Array, width: number, height: number, r: number) {
  if (!(r > 0)) return values;
  const whole = Math.floor(r);
  const part = r - whole;
  const pass = (
    from: Float32Array,
    length: number,
    lines: number,
    stride: number,
    step: number,
  ) => {
    const to = new Float32Array(from.length);
    const at = (line: number, k: number) =>
      from[line * stride + Math.min(length - 1, Math.max(0, k)) * step] as number;
    for (let line = 0; line < lines; line++) {
      let sum = 0;
      for (let k = -whole; k <= whole; k++) sum += at(line, k);
      for (let k = 0; k < length; k++) {
        const edges = at(line, k - whole - 1) + at(line, k + whole + 1);
        to[line * stride + k * step] = (sum + part * edges) / (2 * r + 1);
        sum += at(line, k + whole + 1) - at(line, k - whole);
      }
    }
    return to;
  };
  return pass(pass(values, width, height, width, 1), height, width, 1, width);
}

/** Triangles in the mesh of a full `nx` × `ny` grid: the top, the walls and the bottom's fans. */
const gridTriangles = (nx: number, ny: number) => 2 * nx * ny + 6 * (nx + ny) + 2;

/**
 * Cells across and along for an image `width` × `height` pixels: the most
 * within `budget` triangles, with no more corners than pixels, and in the
 * image's aspect ratio.
 */
export function reliefCells(width: number, height: number, budget: number): [number, number] {
  if (width < 2 || height < 2) throw new ImageReliefError({ code: "image.tooSmall" });
  const wide = width >= height;
  const [long, short] = wide ? [width, height] : [height, width];
  const cellsFor = (n: number): [number, number] => {
    const across = Math.min(short - 1, Math.max(1, Math.round((n * short) / long)));
    return wide ? [n, across] : [across, n];
  };
  let low = 1;
  let high = long - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (gridTriangles(...cellsFor(mid)) <= budget) low = mid;
    else high = mid - 1;
  }
  return cellsFor(low);
}

/**
 * The most pixels the relief of an image `width` × `height` can use within
 * `limits`: two a cell across, so each corner is smoothed from its own. A
 * larger image may be shrunk to this before its pixels are read.
 */
export function reliefPixels(width: number, height: number, limits: StlLimits): [number, number] {
  const [nx] = reliefCells(width, height, triangleBudget(limits));
  const scale = Math.min(1, (2 * nx + 1) / width);
  return [Math.max(2, Math.round(width * scale)), Math.max(2, Math.round(height * scale))];
}

/**
 * The relief of `image` as a closed mesh (ADR-0077): as many cells as
 * `limits` allow and the image has pixels, sized by `settings`.
 */
export function imageReliefMesh(
  image: ReliefImage,
  settings: ImageReliefSettings,
  limits: StlLimits,
): ImageRelief {
  const [nx, ny] = reliefCells(image.width, image.height, triangleBudget(limits));
  // Read at no more pixels than the grid uses, so a large photo takes little memory.
  const [width, height] = reliefPixels(image.width, image.height, limits);
  // Fewer cells than pixels: blurred over a cell too, so the corners don't alias.
  const cell = (Math.floor((width - 1) / nx / 2) * image.width) / width;
  const heights = imageHeights(image, settings.invert, settings.blur + cell, [width, height]);
  const sample = (x: number, y: number) => {
    const x0 = Math.min(width - 2, Math.floor(x));
    const y0 = Math.min(height - 2, Math.floor(y));
    const [fx, fy] = [x - x0, y - y0];
    const h = (i: number, j: number) => heights[(y0 + j) * width + x0 + i] as number;
    return (
      (h(0, 0) * (1 - fx) + h(1, 0) * fx) * (1 - fy) + (h(0, 1) * (1 - fx) + h(1, 1) * fx) * fy
    );
  };

  const top = new Float64Array((nx + 1) * (ny + 1));
  let zMax = 0;
  for (let j = 0; j <= ny; j++) {
    for (let i = 0; i <= nx; i++) {
      // The image's top row is the model's back (largest y).
      const z =
        settings.base +
        settings.relief * sample((i / nx) * (width - 1), (1 - j / ny) * (height - 1));
      top[j * (nx + 1) + i] = z;
      zMax = Math.max(zMax, z);
    }
  }
  const depth = (settings.width * image.height) / image.width;
  const mesh = heightGridMesh({
    nx,
    ny,
    cell: [settings.width / nx, depth / ny],
    inside: new Uint8Array(nx * ny).fill(1),
    top,
  });
  return {
    stl: writeBinaryStl([mesh]),
    triangles: mesh.indices.length / 3,
    size: [settings.width, depth, zMax],
    cells: [nx, ny],
  };
}
