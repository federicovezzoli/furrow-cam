import { type Box3, flattenPath, type Vec3 } from "@furrow/cam-core";
import type { Path, Shape, TouchOffDisc } from "@furrow/document";

/** Arm length in millimetres of the cross drawn for a single-point path (a drill location). */
export const POINT_MARKER_SIZE = 3;

/**
 * A path as `LineSegments` positions on the stock top (`z = 0`, stock
 * coordinates, ADR-0014): `[x, y, z]` per vertex, two vertices per segment.
 * A single-point path (a drill location) is drawn as a cross.
 */
export function pathLinePositions(path: Path): Float32Array {
  const points = flattenPath(path);
  if (points.length === 1) {
    const [[x, y]] = points as [[number, number]];
    const s = POINT_MARKER_SIZE;
    return new Float32Array([x - s, y, 0, x + s, y, 0, x, y - s, 0, x, y + s, 0]);
  }
  const values: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const [ax, ay] = points[i - 1] as [number, number];
    const [bx, by] = points[i] as [number, number];
    values.push(ax, ay, 0, bx, by, 0);
  }
  return new Float32Array(values);
}

/** Segments of the circle drawn for the touch-off pad. */
const TOUCH_OFF_SEGMENTS = 96;

/**
 * The touch-off pad's marker (ADR-0043) as `LineSegments` positions on the
 * stock top: a ring at its diameter, with the line distances a dashed
 * material needs, and a cross at its centre, a third of its radius across
 * each way.
 */
export function touchOffLinePositions({ x, y, diameter }: TouchOffDisc): {
  ring: Float32Array;
  distances: Float32Array;
  cross: Float32Array;
} {
  const r = diameter / 2;
  const ring = new Float32Array(TOUCH_OFF_SEGMENTS * 6);
  const distances = new Float32Array(TOUCH_OFF_SEGMENTS * 2);
  const step = (2 * Math.PI) / TOUCH_OFF_SEGMENTS;
  const length = 2 * r * Math.sin(step / 2);
  for (let i = 0; i < TOUCH_OFF_SEGMENTS; i++) {
    const a = i * step;
    const b = a + step;
    ring.set(
      [x + r * Math.cos(a), y + r * Math.sin(a), 0, x + r * Math.cos(b), y + r * Math.sin(b), 0],
      i * 6,
    );
    distances.set([i * length, (i + 1) * length], i * 2);
  }
  const s = r / 3;
  const cross = new Float32Array([x - s, y, 0, x + s, y, 0, x, y - s, 0, x, y + s, 0]);
  return { ring, distances, cross };
}

/** A shape's paths as `LineSegments` positions, like `pathLinePositions`. */
export function shapeLinePositions(shape: Shape): Float32Array {
  return pathsLinePositions(shape.paths);
}

/**
 * Flattened paths by identity. Immer keeps unchanged shapes and their paths
 * as the same objects (ADR-0010), so only new or edited paths are flattened
 * again.
 */
const pathCache = new WeakMap<Path, Float32Array>();

function cachedPathLinePositions(path: Path): Float32Array {
  let positions = pathCache.get(path);
  if (!positions) {
    positions = pathLinePositions(path);
    pathCache.set(path, positions);
  }
  return positions;
}

/** Several paths' line positions in one buffer, to draw them in a single call (ADR-0008). */
export function pathsLinePositions(paths: Iterable<Path>): Float32Array {
  return concatPositions(Array.from(paths, cachedPathLinePositions));
}

/** `parts` one after another in one buffer. */
export function concatPositions(parts: readonly Float32Array[]): Float32Array {
  const merged = new Float32Array(parts.reduce((length, part) => length + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    merged.set(part, offset);
    offset += part.length;
  }
  return merged;
}

/** Several shapes' line positions in one buffer, like `pathsLinePositions`. */
export function shapesLinePositions(shapes: Iterable<Shape>): Float32Array {
  return pathsLinePositions(Array.from(shapes, (shape) => shape.paths).flat());
}

export type GridLines = { minor: Float32Array; major: Float32Array };

/**
/** Most lines a grid draws along each axis; past it, the grid gets coarser. */
export const MAX_GRID_LINES = 1000;

/**
 * A grid under the stock at `bounds.min` z, aligned to the work origin and
 * reaching `margin` past the stock and the origin (a custom zero may lie
 * outside the stock): lines every `spacing` mm, every `majorEvery`-th one major.
 * When that would take more than `MAX_GRID_LINES` along an axis, the spacing
 * grows `majorEvery` times until it doesn't, so a far-away origin can't stall it.
 */
export function gridLinePositions(
  bounds: Box3,
  { spacing: fineSpacing = 10, majorEvery = 10, margin = 50 } = {},
): GridLines {
  const z = bounds.min[2];
  const from = (axis: 0 | 1) => Math.min(bounds.min[axis], 0) - margin;
  const to = (axis: 0 | 1) => Math.max(bounds.max[axis], 0) + margin;
  const extent = Math.max(to(0) - from(0), to(1) - from(1));
  let spacing = fineSpacing;
  while (extent / spacing > MAX_GRID_LINES) spacing *= majorEvery;
  const range = (axis: 0 | 1) => [Math.floor(from(axis) / spacing), Math.ceil(to(axis) / spacing)];
  const [x0, x1] = range(0) as [number, number];
  const [y0, y1] = range(1) as [number, number];
  const minor: number[] = [];
  const major: number[] = [];
  for (let i = x0; i <= x1; i++) {
    const x = i * spacing;
    (i % majorEvery === 0 ? major : minor).push(x, y0 * spacing, z, x, y1 * spacing, z);
  }
  for (let j = y0; j <= y1; j++) {
    const y = j * spacing;
    (j % majorEvery === 0 ? major : minor).push(x0 * spacing, y, z, x1 * spacing, y, z);
  }
  return { minor: new Float32Array(minor), major: new Float32Array(major) };
}

/** The smallest box holding `box` and `point`. */
export function boxWithPoint({ min, max }: Box3, point: Vec3): Box3 {
  return {
    min: min.map((v, i) => Math.min(v, point[i] as number)) as Vec3,
    max: max.map((v, i) => Math.max(v, point[i] as number)) as Vec3,
  };
}

/** Room left around the stock when the camera fits it. */
const FIT_PADDING = 1.15;

export function boxCenter({ min, max }: Box3): Vec3 {
  return [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
}

/** Orthographic zoom (pixels per millimetre) that fits the box's top face in a viewport. */
export function fitTopZoom({ min, max }: Box3, size: { width: number; height: number }): number {
  const zoom = Math.min(
    size.width / ((max[0] - min[0]) * FIT_PADDING),
    size.height / ((max[1] - min[1]) * FIT_PADDING),
  );
  return Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
}

/**
 * How many pixels a millimetre covers on screen: the zoom of an orthographic
 * camera, or for a perspective one (`fov` in degrees) a millimetre `distance`
 * away, in a viewport `height` pixels tall.
 */
export function pixelsPerMillimetre(
  camera: { zoom: number; fov?: number },
  height: number,
  distance: number,
): number {
  if (camera.fov === undefined) return camera.zoom;
  const visible = 2 * distance * Math.tan((camera.fov * Math.PI) / 360);
  return visible > 0 ? (height / visible) * camera.zoom : 1;
}

/** Looking at the stock from the front right, above it. */
const ORBIT_DIRECTION: Vec3 = [0.4, -1, 0.9];

/**
 * Perspective camera position that shows the whole box, seen from the front
 * right; `fov` is the vertical field of view in degrees, `aspect` width / height.
 */
export function fitOrbitPosition(box: Box3, fov: number, aspect: number): Vec3 {
  const center = boxCenter(box);
  const radius = Math.hypot(...box.max.map((v, i) => v - (box.min[i] as number))) / 2;
  const vertical = (fov * Math.PI) / 180;
  const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * aspect);
  const distance = (radius * FIT_PADDING) / Math.sin(Math.min(vertical, horizontal) / 2);
  const length = Math.hypot(...ORBIT_DIRECTION);
  return center.map((c, i) => c + ((ORBIT_DIRECTION[i] as number) / length) * distance) as Vec3;
}
