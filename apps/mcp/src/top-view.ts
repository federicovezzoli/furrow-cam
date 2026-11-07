import { crc32, deflateSync } from "node:zlib";
import { flattenPath, flipShapes, type ToolpathMove } from "@furrow/cam-core";
import { clearingTool, type Point, type ProjectDocument, type StockSide } from "@furrow/document";
import type { ComputedToolpath } from "@furrow/post";

/** The longest side of the image, in pixels. */
const MAX_SIZE = 1024;
/** Space around the stock, in pixels. */
const MARGIN = 24;
/** Each pixel is drawn as `SUPERSAMPLE` × `SUPERSAMPLE` and averaged, for smooth lines. */
const SUPERSAMPLE = 2;

type Rgb = [number, number, number];

const BACKGROUND: Rgb = [255, 255, 255];
const STOCK: Rgb = [243, 234, 217];
const STOCK_EDGE: Rgb = [138, 127, 110];
const DRAWING: Rgb = [60, 60, 60];

/** `#rrggbb` as RGB; mid grey for anything else. */
function rgb(color: string): Rgb {
  const hex = /^#([0-9a-f]{6})$/i.exec(color)?.[1];
  if (!hex) return [128, 128, 128];
  const value = Number.parseInt(hex, 16);
  return [value >> 16, (value >> 8) & 0xff, value & 0xff];
}

/** An RGB canvas `width` × `height` pixels, drawn on in pixel coordinates. */
class Canvas {
  readonly pixels: Uint8Array;
  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.pixels = new Uint8Array(width * height * 3);
  }

  /** Fills the pixels `[x0, x1) × [y0, y1)`, clipped to the canvas. */
  fill(x0: number, y0: number, x1: number, y1: number, [r, g, b]: Rgb) {
    const left = Math.max(0, Math.floor(x0));
    const right = Math.min(this.width, Math.ceil(x1));
    const top = Math.max(0, Math.floor(y0));
    const bottom = Math.min(this.height, Math.ceil(y1));
    for (let y = top; y < bottom; y++) {
      for (let x = left; x < right; x++) {
        const i = (y * this.width + x) * 3;
        this.pixels[i] = r;
        this.pixels[i + 1] = g;
        this.pixels[i + 2] = b;
      }
    }
  }

  /** A line `thickness` pixels wide from `a` to `b`, as squares stamped along it. */
  line([ax, ay]: Point, [bx, by]: Point, color: Rgb, thickness: number) {
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(bx - ax), Math.abs(by - ay))));
    const half = thickness / 2;
    for (let i = 0; i <= steps; i++) {
      const x = ax + ((bx - ax) * i) / steps;
      const y = ay + ((by - ay) * i) / steps;
      this.fill(x - half, y - half, x + half, y + half, color);
    }
  }

  /** The canvas shrunk `factor` times, each pixel the average of the `factor` × `factor` it covers. */
  shrink(factor: number): Canvas {
    const out = new Canvas(Math.floor(this.width / factor), Math.floor(this.height / factor));
    const area = factor * factor;
    for (let y = 0; y < out.height; y++) {
      for (let x = 0; x < out.width; x++) {
        for (let c = 0; c < 3; c++) {
          let sum = 0;
          for (let dy = 0; dy < factor; dy++) {
            for (let dx = 0; dx < factor; dx++) {
              sum += this.pixels[((y * factor + dy) * this.width + x * factor + dx) * 3 + c] ?? 0;
            }
          }
          out.pixels[(y * out.width + x) * 3 + c] = Math.round(sum / area);
        }
      }
    }
    return out;
  }
}

/** `canvas` as an 8-bit RGB PNG. */
function png({ width, height, pixels }: Canvas): Uint8Array {
  // Each row starts with filter type 0 (none).
  const raw = new Uint8Array((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw.set(pixels.subarray(y * width * 3, (y + 1) * width * 3), y * (width * 3 + 1) + 1);
  }
  const chunk = (type: string, data: Uint8Array) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, "ascii");
    out.set(data, 8);
    out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8 bits per channel, RGB, no interlace
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", new Uint8Array()),
  ]);
}

/** The XY of each move that plunges straight down, once each: a drill's holes. */
function plunges(moves: ToolpathMove[]): Point[] {
  const holes = new Map<string, Point>();
  let previous: ToolpathMove["to"] | null = null;
  for (const move of moves) {
    const [x, y, z] = move.to;
    if (
      move.kind === "feed" &&
      previous &&
      previous[0] === x &&
      previous[1] === y &&
      z < previous[2]
    ) {
      holes.set(`${x},${y}`, [x, y]);
    }
    previous = move.to;
  }
  return [...holes.values()];
}

/** What the image shows, for the assistant: what each colour is. */
export type TopViewLegend = {
  side: StockSide;
  millimetresPerPixel: number;
  /** The area the image shows, in stock coordinates, without its blank margin. */
  shown: { minX: number; minY: number; maxX: number; maxY: number };
  operations: { id: string; name: string; type: string; color: string; tool: string }[];
};

/**
 * A top view of `document`'s `side` (PRD-0012 M10) as a PNG, drawn without a
 * DOM: the stock, the drawings' shapes, and the cutting moves of `computed`
 * on that side, each operation in its tool's colour as the app's viewport
 * draws them, a V-carve's flat bottom in its end mill's, with a circle the
 * size of the tool at each drilled hole. Rapids are left out.
 */
export function topView(
  document: ProjectDocument,
  computed: ComputedToolpath[],
  side: StockSide,
): { png: Uint8Array; legend: TopViewLegend } {
  const { stock } = document;
  const flip =
    side === "bottom" && stock.twoSided ? { ...stock, axis: stock.twoSided.flipAxis } : null;
  const shapes = flip ? flipShapes(document.geometry, flip) : document.geometry;
  const lines = shapes.flatMap((shape) =>
    shape.paths.map((path) => {
      const points = flattenPath(path);
      return path.closed && points.length > 1 ? [...points, points[0] as Point] : points;
    }),
  );
  const drawn = computed.filter(({ input }) => input.operation.stockSide === side);

  // The stock and everything drawn, which may reach past it (an outside profile at its edge).
  const box = { minX: 0, minY: 0, maxX: stock.width, maxY: stock.height };
  const extend = ([x, y]: readonly number[], margin = 0) => {
    box.minX = Math.min(box.minX, (x ?? 0) - margin);
    box.minY = Math.min(box.minY, (y ?? 0) - margin);
    box.maxX = Math.max(box.maxX, (x ?? 0) + margin);
    box.maxY = Math.max(box.maxY, (y ?? 0) + margin);
  };
  for (const points of lines) for (const point of points) extend(point);
  for (const { input, toolpath } of drawn) {
    for (const move of [...(toolpath.clearing ?? []), ...toolpath.moves]) {
      if (move.kind === "feed") extend(move.to);
    }
    if (input.operation.type === "drill") {
      for (const hole of plunges(toolpath.moves)) extend(hole, input.operation.tool.diameter / 2);
    }
  }

  const scale = (MAX_SIZE - 2 * MARGIN) / Math.max(box.maxX - box.minX, box.maxY - box.minY);
  const width = Math.round((box.maxX - box.minX) * scale) + 2 * MARGIN;
  const height = Math.round((box.maxY - box.minY) * scale) + 2 * MARGIN;
  const canvas = new Canvas(width * SUPERSAMPLE, height * SUPERSAMPLE);
  // Stock coordinates have y up; the image has it down.
  const px = ([x, y]: readonly number[]): Point => [
    (MARGIN + ((x ?? 0) - box.minX) * scale) * SUPERSAMPLE,
    (height - MARGIN - ((y ?? 0) - box.minY) * scale) * SUPERSAMPLE,
  ];

  canvas.fill(0, 0, canvas.width, canvas.height, BACKGROUND);
  const [left, top] = px([0, stock.height]);
  const [right, bottom] = px([stock.width, 0]);
  canvas.fill(left, top, right, bottom, STOCK);
  const corners: Point[] = [
    [left, top],
    [right, top],
    [right, bottom],
    [left, bottom],
  ];
  corners.forEach((corner, i) => {
    canvas.line(corner, corners[(i + 1) % 4] as Point, STOCK_EDGE, SUPERSAMPLE);
  });
  for (const points of lines) {
    for (let i = 1; i < points.length; i++) {
      canvas.line(px(points[i - 1] as Point), px(points[i] as Point), DRAWING, SUPERSAMPLE);
    }
  }

  const drawMoves = (moves: ToolpathMove[], color: Rgb) => {
    let previous: Point | null = null;
    for (const move of moves) {
      const point = px(move.to);
      if (move.kind === "feed" && previous) canvas.line(previous, point, color, SUPERSAMPLE);
      previous = point;
    }
  };
  for (const { input, toolpath } of drawn) {
    const { operation } = input;
    const clearing = clearingTool(operation);
    if (clearing && toolpath.clearing) drawMoves(toolpath.clearing, rgb(clearing.color));
    const color = rgb(operation.tool.color);
    drawMoves(toolpath.moves, color);
    if (operation.type === "drill") {
      const radius = (operation.tool.diameter / 2) * scale * SUPERSAMPLE;
      const segments = Math.max(12, Math.ceil(radius));
      for (const [x, y] of plunges(toolpath.moves)) {
        const [cx, cy] = px([x, y]);
        for (let i = 0; i < segments; i++) {
          const at = (j: number): Point => [
            cx + radius * Math.cos((2 * Math.PI * j) / segments),
            cy + radius * Math.sin((2 * Math.PI * j) / segments),
          ];
          canvas.line(at(i), at(i + 1), color, SUPERSAMPLE);
        }
      }
    }
  }

  return {
    png: png(canvas.shrink(SUPERSAMPLE)),
    legend: {
      side,
      millimetresPerPixel: 1 / scale,
      shown: box,
      operations: drawn.map(({ input: { operation } }) => ({
        id: operation.id,
        name: operation.name,
        type: operation.type,
        color: operation.tool.color,
        tool: operation.tool.name,
      })),
    },
  };
}
