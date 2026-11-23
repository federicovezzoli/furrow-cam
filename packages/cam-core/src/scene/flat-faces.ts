import type { Model, Path, Point } from "@furrow/document";
import { applyAffine } from "../geometry/affine";
import { isRound, roundness } from "../geometry/circle";
import { nest, type Polygon, signedArea, simplify, union } from "../geometry/clipper";
import { polygonPath } from "../geometry/path";
import { roundCoordinate } from "../geometry/round";
import { modelTransform } from "./model";

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
  const triangles: Placed[] = [];
  for (let t = 0; t < count; t++) {
    const corners: Polygon = [];
    let low = Infinity;
    let high = -Infinity;
    for (let v = 0; v < 3; v++) {
      const i = t * 9 + v * 3;
      const [x, y, z] = applyAffine(transform, [
        positions[i] as number,
        positions[i + 1] as number,
        positions[i + 2] as number,
      ]);
      corners.push([x, y]);
      low = Math.min(low, z);
      high = Math.max(high, z);
    }
    triangles.push({ corners, area: signedArea(corners), low, high });
  }

  const flat: Placed[] = [];
  if (model.faces) {
    let first = 0;
    for (const size of model.faces) {
      const face = triangles.slice(first, first + size);
      first += size;
      // A loop, not a spread: a face may hold more triangles than a call takes arguments.
      let low = Infinity;
      let high = -Infinity;
      let area = 0;
      for (const triangle of face) {
        low = Math.min(low, triangle.low);
        high = Math.max(high, triangle.high);
        area += triangle.area;
      }
      if (high - low <= LEVEL_TOLERANCE && area > 0) {
        for (const triangle of face) flat.push({ ...triangle, low, high });
      }
    }
  } else {
    for (const triangle of triangles) {
      if (triangle.high - triangle.low <= LEVEL_TOLERANCE && triangle.area > 0) flat.push(triangle);
    }
  }

  // Highest first; a level runs on while each next triangle is within the tolerance of the last.
  flat.sort((a, b) => b.high - a.high);
  const levels: FlatLevel[] = [];
  let group: Placed[] = [];
  const close = () => {
    const level = flatLevel(group);
    if (level) levels.push(level);
    group = [];
  };
  for (const triangle of flat) {
    const last = group.at(-1);
    if (last && last.high - triangle.high > LEVEL_TOLERANCE) close();
    group.push(triangle);
  }
  close();

  const upward = triangles.filter(({ area }) => area > 0).map(({ corners }) => corners);
  const outline = nest(union(upward))
    .map(({ outer }) => outer)
    .filter((ring) => Math.abs(signedArea(ring)) >= MIN_RING_AREA)
    .map(ringPath);
  return { levels, outline };
}

/** The outlines of one level's triangles, or `null` if they cover too little. */
function flatLevel(triangles: Placed[]): FlatLevel | null {
  const [first] = triangles;
  if (!first) return null;
  const rings = simplify(union(triangles.map(({ corners }) => corners)), SIMPLIFY).filter(
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
  if (!round || !isRound(round)) return polygon;
  // A tessellated circle's vertices lie on it; its chords cut inside.
  const center = round.center.map(roundCoordinate) as Point;
  const start: Point = [roundCoordinate(center[0] + round.max), center[1]];
  return { start, segments: [{ kind: "arc", to: start, center, clockwise: false }], closed: true };
}
