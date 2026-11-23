import type { Model, Path, Point } from "@furrow/document";
import { applyAffine } from "../geometry/affine";
import { DRILL_DIAMETER_TOLERANCE, roundness } from "../geometry/circle";
import { nest, type Polygon, signedArea, simplify, union } from "../geometry/clipper";
import { polygonPath } from "../geometry/path";
import { roundCoordinate } from "../geometry/round";
import { modelTransform, placedModelBox } from "./model";
import type { Vec3 } from "./stock";

/**
 * Drawings from a model's flat faces (#665): the 2D outlines that pocket,
 * profile and drill operations machine a 2.5D part with, instead of relief
 * passes.
 */

/** A flat, upward-facing level of a placed model: its outlines at height `z` (0 is the stock top). */
export type FlatLevel = { z: number; paths: Path[] };

export type ModelFlatFaces = {
  /** From the highest level down. */
  levels: FlatLevel[];
  /** The model's outline seen from above, without its holes. */
  outline: Path[];
};

/** How far apart, in millimetres, flat triangles' heights may be and still lie on one level. */
const LEVEL_TOLERANCE = 0.005;

/**
 * The smallest area, in mm², a level keeps. Without a STEP file's faces, the
 * near-flat facets at the top of a curved surface would read as levels.
 */
const MIN_LEVEL_AREA = 1;

/** Rings smaller than this, in mm², are slivers the union leaves behind. */
const MIN_RING_AREA = 0.01;

/** Vertices this close, in millimetres, to the line through their neighbours are dropped. */
const SIMPLIFY = 0.001;

/** A triangle placed in stock coordinates: its XY corners and its lowest and highest Z. */
type Placed = { corners: Polygon; area: number; low: number; high: number };

/**
 * The flat, upward-facing levels of `model`'s mesh `positions` (9 values
 * per triangle, as `parseStl` reads them) and its outline, in stock
 * coordinates as placed. With `faces` (a STEP file's, ADR-0094) a face is
 * flat when all of it is; without, each triangle is taken on its own. A
 * level's outlines merge every flat face at its height; a round one becomes a
 * full-circle arc, so it is drilled and cut as a circle.
 */
export function modelFlatFaces(
  positions: Float32Array,
  model: Pick<Model, "bounds" | "placement" | "faces">,
): ModelFlatFaces {
  const transform = modelTransform(model);
  const count = positions.length / 9;
  const vertex = (t: number, v: number): Vec3 => {
    const i = t * 9 + v * 3;
    return applyAffine(transform, [
      positions[i] as number,
      positions[i + 1] as number,
      positions[i + 2] as number,
    ]);
  };

  // Six times the volume the mesh encloses, negative when its triangles face inwards, as STL
  // files often wind every one (mixed winding isn't mended). Heights are taken from the model's
  // bottom, so an open surface facing up counts as positive too.
  const bottom = placedModelBox(model).min[2];
  let volume = 0;
  for (let t = 0; t < count; t++) {
    const [a, b, c] = [vertex(t, 0), vertex(t, 1), vertex(t, 2)];
    const [az, bz, cz] = [a[2] - bottom, b[2] - bottom, c[2] - bottom];
    volume +=
      a[0] * (b[1] * cz - bz * c[1]) -
      a[1] * (b[0] * cz - bz * c[0]) +
      az * (b[0] * c[1] - b[1] * c[0]);
  }
  const inward = volume < 0;

  // Each triangle is placed as it is needed: a large mesh's would take gigabytes all at once.
  const placed = (t: number): Placed => {
    const vertices = [vertex(t, 0), vertex(t, 1), vertex(t, 2)];
    if (inward) vertices.reverse();
    const corners = vertices.map(([x, y]): Point => [x, y]);
    const heights = vertices.map(([, , z]) => z);
    return {
      corners,
      area: signedArea(corners),
      low: Math.min(...heights),
      high: Math.max(...heights),
    };
  };

  // With `faces`, a face is flat if all of it is; without, each triangle is a face of its own.
  const flat: Placed[] = [];
  const outline = unionInChunks();
  for (let t = 0, f = 0; t < count; f++) {
    const end = t + (model.faces ? (model.faces[f] as number) : 1);
    const face: Placed[] = [];
    let low = Infinity;
    let high = -Infinity;
    let area = 0;
    for (; t < end; t++) {
      const triangle = placed(t);
      face.push(triangle);
      low = Math.min(low, triangle.low);
      high = Math.max(high, triangle.high);
      area += triangle.area;
      if (triangle.area > 0) outline.add(triangle.corners);
    }
    if (high - low <= LEVEL_TOLERANCE && area > 0) {
      for (const triangle of face) flat.push({ ...triangle, low, high });
    }
  }

  // Highest first; a level takes the triangles within the tolerance of its top.
  flat.sort((a, b) => b.high - a.high);
  const levels: FlatLevel[] = [];
  let group: Placed[] = [];
  const close = () => {
    const level = flatLevel(group);
    if (level) levels.push(level);
    group = [];
  };
  for (const triangle of flat) {
    const [top] = group;
    if (top && top.high - triangle.high > LEVEL_TOLERANCE) close();
    group.push(triangle);
  }
  close();

  return {
    levels,
    outline: nest(outline.result())
      .map(({ outer }) => outer)
      .filter((ring) => Math.abs(signedArea(ring)) >= MIN_RING_AREA)
      .map(ringPath),
  };
}

/** How many polygons Clipper2 unites at once: it slows down far more than in proportion on one huge input. */
const UNION_CHUNK = 4096;

/**
 * The union of the polygons `add`ed, a chunk at a time, then of the chunks'
 * results: about 2 s for 2 million triangles, where one union takes minutes.
 */
function unionInChunks() {
  let chunk: Polygon[] = [];
  let parts: Polygon[] = [];
  const flush = () => {
    if (chunk.length > 0) parts.push(...union(chunk));
    chunk = [];
  };
  return {
    add(polygon: Polygon) {
      chunk.push(polygon);
      if (chunk.length === UNION_CHUNK) flush();
    },
    result(): Polygon[] {
      flush();
      // Unite the results the same way while that still makes fewer of them.
      while (parts.length > UNION_CHUNK) {
        const before = parts;
        parts = [];
        for (const polygon of before) {
          chunk.push(polygon);
          if (chunk.length === UNION_CHUNK) flush();
        }
        flush();
        if (parts.length >= before.length) break;
      }
      return union(parts);
    },
  };
}

/** The outlines of one level's triangles, or `null` if they cover too little. */
function flatLevel(triangles: Placed[]): FlatLevel | null {
  const [first] = triangles;
  if (!first) return null;
  const all = unionInChunks();
  for (const { corners } of triangles) all.add(corners);
  const rings = simplify(all.result(), SIMPLIFY).filter(
    (ring) => Math.abs(signedArea(ring)) >= MIN_RING_AREA,
  );
  // Outer rings count positive, holes negative.
  const area = rings.reduce((sum, ring) => sum + signedArea(ring), 0);
  if (area < MIN_LEVEL_AREA) return null;
  const z = triangles.reduce((sum, { low, high }) => sum + low + high, 0) / (2 * triangles.length);
  return { z: roundCoordinate(z), paths: rings.map(ringPath) };
}

/** A ring as a path: a full-circle arc if it is round, as a tessellated hole is, else a polygon. */
function ringPath(ring: Polygon): Path {
  const polygon = polygonPath(
    ring.map(([x, y]): Point => [roundCoordinate(x), roundCoordinate(y)]),
  );
  const round = ring.length >= 8 ? roundness(polygon) : null;
  // Within drilling's fixed tolerance only, not its share of the radius: a large near-round ring stays as it is.
  if (!round || round.max - round.min > DRILL_DIAMETER_TOLERANCE) return polygon;
  // A tessellated circle's vertices lie on it; its chords cut inside.
  const center = round.center.map(roundCoordinate) as Point;
  const start: Point = [roundCoordinate(center[0] + round.max), center[1]];
  return { start, segments: [{ kind: "arc", to: start, center, clockwise: false }], closed: true };
}
