import { type Box3, flattenPath, type Vec3 } from "@furrow/cam-core";
import type { Shape } from "@furrow/document";

/** Arm length in millimetres of the cross drawn for a single-point path (a drill location). */
export const POINT_MARKER_SIZE = 3;

/**
 * A shape as `LineSegments` positions on the stock top (`z = 0`, stock
 * coordinates, ADR-0014): `[x, y, z]` per vertex, two vertices per segment.
 */
export function shapeLinePositions(shape: Shape): Float32Array {
  const values: number[] = [];
  for (const path of shape.paths) {
    const points = flattenPath(path);
    if (points.length === 1) {
      const [[x, y]] = points as [[number, number]];
      const s = POINT_MARKER_SIZE;
      values.push(x - s, y, 0, x + s, y, 0, x, y - s, 0, x, y + s, 0);
      continue;
    }
    for (let i = 1; i < points.length; i++) {
      const [ax, ay] = points[i - 1] as [number, number];
      const [bx, by] = points[i] as [number, number];
      values.push(ax, ay, 0, bx, by, 0);
    }
  }
  return new Float32Array(values);
}

/**
 * Flattened shapes by identity. Immer keeps unchanged shapes as the same
 * objects (ADR-0010), so only new or edited shapes are flattened again.
 */
const shapeCache = new WeakMap<Shape, Float32Array>();

function cachedShapeLinePositions(shape: Shape): Float32Array {
  let positions = shapeCache.get(shape);
  if (!positions) {
    positions = shapeLinePositions(shape);
    shapeCache.set(shape, positions);
  }
  return positions;
}

/** Several shapes' line positions in one buffer, to draw them in a single call (ADR-0008). */
export function shapesLinePositions(shapes: Iterable<Shape>): Float32Array {
  const parts = Array.from(shapes, cachedShapeLinePositions);
  const merged = new Float32Array(parts.reduce((length, part) => length + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    merged.set(part, offset);
    offset += part.length;
  }
  return merged;
}

export type GridLines = { minor: Float32Array; major: Float32Array };

/**
 * A grid under the stock at `bounds.min` z, aligned to the work origin and
 * reaching `margin` past the stock: lines every `spacing` mm, every
 * `majorEvery`-th one major.
 */
export function gridLinePositions(
  bounds: Box3,
  { spacing = 10, majorEvery = 10, margin = 50 } = {},
): GridLines {
  const z = bounds.min[2];
  const range = (axis: 0 | 1) => [
    Math.floor((bounds.min[axis] - margin) / spacing),
    Math.ceil((bounds.max[axis] + margin) / spacing),
  ];
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
