import { GEOMETRY_TOLERANCE, type Point } from "@furrow/document";
import Delaunator from "delaunator";
import { type FillRule, type Polygon, union } from "./clipper";

// Medial-axis adapter (ADR-0025). The rest of the CAM core uses this function
// and never imports Delaunator directly.

/**
 * A run of the medial axis between two ends or junctions: `points[i]` is the
 * centre of the largest disk inside the shape there, `radii[i]` its radius in
 * millimetres (the distance to the nearest edge). Corner branches end on the
 * corner with radius 0; a branch that closes on itself (the axis of a ring)
 * ends on its first point.
 */
export type MedialAxisBranch = { points: Point[]; radii: number[] };

export type MedialAxisOptions = {
  /** Largest distance in millimetres between boundary samples. Smaller is more accurate and slower. */
  spacing?: number;
  /**
   * Smallest angle in degrees, seen from the axis, between the two nearest
   * edge points of a branch. Branches under it run into nearly flat corners,
   * such as the vertices of flattened curves, and are dropped; corners sharper
   * than 180° minus this angle keep their branch.
   */
  minAngle?: number;
  /** How the input rings combine. */
  fillRule?: FillRule;
};

/** Boundary sample spacing in millimetres; see ADR-0025 for the accuracy it buys. */
export const DEFAULT_MEDIAL_AXIS_SPACING = 0.2;

/** Default `minAngle` in degrees. */
export const DEFAULT_MEDIAL_AXIS_ANGLE = 30;

/** Disk centres closer than this many millimetres are one node. */
const MERGE_DISTANCE = 1e-6;

/** Closest sample to a sharp corner, in millimetres: the axis reaches the tip from there. */
const CORNER_RESOLUTION = GEOMETRY_TOLERANCE;

/**
 * Smallest radius, in millimetres, of the largest disk a separate part of the
 * axis needs to stand on its own: a V-bit following one under it carves a
 * groove no wider than twice that. Such a part is joined to the axis within
 * this distance, or dropped.
 */
const MIN_COMPONENT_RADIUS = 0.01;

/** Sample spacing near a sharp corner, as a fraction of the wedge's width. */
const CORNER_GRADING = 0.5;

/**
 * The medial axis of the area covered by `polygons`: the centres of the
 * maximal disks inside it, with their radii, as branches between ends and
 * junctions. A V-bit following it at a depth set by the radius cuts up to the
 * edges and never past them.
 *
 * The boundary is sampled every `spacing` millimetres, closer towards sharp
 * corners so the axis reaches their tips, and the Voronoi vertices
 * of the samples (Delaunay circumcentres) inside the area are joined where two
 * samples on different, not nearly parallel, edges are equally near. Radii are
 * the exact distance to those edges, so they are never larger than the true
 * distance by more than a tiny fraction of the spacing.
 */
export function medialAxis(
  polygons: Polygon[],
  options: MedialAxisOptions = {},
): MedialAxisBranch[] {
  const spacing = options.spacing ?? DEFAULT_MEDIAL_AXIS_SPACING;
  if (!(spacing > 0)) throw new RangeError("Sample spacing must be positive");
  const minAngle = ((options.minAngle ?? DEFAULT_MEDIAL_AXIS_ANGLE) * Math.PI) / 180;
  // Outer boundaries counter-clockwise and holes clockwise: the area is left of every edge.
  const maxTurnCosine = Math.cos(minAngle);
  const boundary = new Boundary(
    union(polygons, options.fillRule ?? "nonZero"),
    spacing,
    maxTurnCosine,
  );
  if (boundary.sampleCount < 3) return [];
  const disks = new Disks(boundary);
  const graph = new Graph(disks);
  joinVoronoiEdges(graph, disks, Math.sin(minAngle / 2));
  joinCorners(graph, disks);
  return graph.branches();
}

/** The boundary edges and the samples along them. */
class Boundary {
  /** Edge `e` runs from (ax[e], ay[e]) to (bx[e], by[e]). */
  readonly ax: number[] = [];
  readonly ay: number[] = [];
  readonly bx: number[] = [];
  readonly by: number[] = [];
  /** The edge before edge `e` on its ring. */
  readonly previous: number[] = [];
  /** Sample coordinates, interleaved x, y. */
  readonly coords: Float64Array;
  /** The edge each sample lies on; a sample on a vertex lies on the edge starting there. */
  readonly edge: number[] = [];
  readonly isVertex: boolean[] = [];

  /** Whether edge `e` starts at a convex corner sharp enough to get its own branch. */
  readonly startsAtSharpCorner: boolean[] = [];

  constructor(rings: Polygon[], spacing: number, maxTurnCosine: number) {
    const coords: number[] = [];
    for (const ring of rings) {
      const n = ring.length;
      if (n < 3) continue;
      const first = this.ax.length;
      // tan(half the inside angle) at each sharp convex corner, 0 elsewhere.
      const corners = ring.map((_, i) =>
        cornerSlope(
          ring[(i + n - 1) % n] as Point,
          ring[i] as Point,
          ring[(i + 1) % n] as Point,
          maxTurnCosine,
        ),
      );
      for (let i = 0; i < n; i++) {
        const [ax, ay] = ring[i] as Point;
        const [bx, by] = ring[(i + 1) % n] as Point;
        const e = this.ax.length;
        this.ax.push(ax);
        this.ay.push(ay);
        this.bx.push(bx);
        this.by.push(by);
        this.previous.push(i === 0 ? first + n - 1 : e - 1);
        const startSlope = corners[i] as number;
        this.startsAtSharpCorner.push(startSlope > 0);
        const length = Math.hypot(bx - ax, by - ay);
        const along = edgeSamples(length, spacing, startSlope, corners[(i + 1) % n] as number);
        along.forEach((d, j) => {
          coords.push(ax + ((bx - ax) * d) / length, ay + ((by - ay) * d) / length);
          this.edge.push(e);
          this.isVertex.push(j === 0);
        });
      }
    }
    this.coords = Float64Array.from(coords);
  }

  get sampleCount(): number {
    return this.edge.length;
  }

  /** Twice the signed area of edge `e` and point (x, y): positive when the point is left of it. */
  side(e: number, x: number, y: number): number {
    const ax = this.ax[e] as number;
    const ay = this.ay[e] as number;
    return ((this.bx[e] as number) - ax) * (y - ay) - ((this.by[e] as number) - ay) * (x - ax);
  }

  /** Whether (x, y) is on the area's side of the boundary at sample `s`. */
  inside(s: number, x: number, y: number): boolean {
    const e = this.edge[s] as number;
    if (!this.isVertex[s]) return this.side(e, x, y) > 0;
    const p = this.previous[e] as number;
    const left = this.side(p, x, y) > 0;
    const right = this.side(e, x, y) > 0;
    return this.turn(s) > 0 ? left && right : left || right;
  }

  /** Cross product of the edge directions at vertex sample `s`: positive at a convex corner. */
  turn(s: number): number {
    const e = this.edge[s] as number;
    const p = this.previous[e] as number;
    const [ux, uy] = this.direction(p);
    const [vx, vy] = this.direction(e);
    return ux * vy - uy * vx;
  }

  /** Distance from (x, y) to the edges sample `s` lies on. */
  distance(s: number, x: number, y: number): number {
    const e = this.edge[s] as number;
    const d = this.edgeDistance(e, x, y);
    return this.isVertex[s] ? Math.min(d, this.edgeDistance(this.previous[e] as number, x, y)) : d;
  }

  /** Whether samples `s` and `t` lie on a common edge. */
  shareEdge(s: number, t: number): boolean {
    const es = this.edge[s] as number;
    const et = this.edge[t] as number;
    const ps = this.isVertex[s] ? (this.previous[es] as number) : -1;
    const pt = this.isVertex[t] ? (this.previous[et] as number) : -2;
    return es === et || es === pt || ps === et || ps === pt;
  }

  private direction(e: number): [number, number] {
    return [
      (this.bx[e] as number) - (this.ax[e] as number),
      (this.by[e] as number) - (this.ay[e] as number),
    ];
  }

  private edgeDistance(e: number, x: number, y: number): number {
    const ax = this.ax[e] as number;
    const ay = this.ay[e] as number;
    const [dx, dy] = this.direction(e);
    const length2 = dx * dx + dy * dy;
    const t = length2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / length2)) : 0;
    return Math.hypot(x - ax - t * dx, y - ay - t * dy);
  }
}

/**
 * tan of half the inside angle at `corner` if it is convex and turns by more
 * than the angle whose cosine is `maxTurnCosine`, otherwise 0. The area near
 * such a corner is a wedge as wide as this many times the distance to it.
 */
function cornerSlope(before: Point, corner: Point, after: Point, maxTurnCosine: number): number {
  const ux = corner[0] - before[0];
  const uy = corner[1] - before[1];
  const vx = after[0] - corner[0];
  const vy = after[1] - corner[1];
  const length = Math.hypot(ux, uy) * Math.hypot(vx, vy);
  const sin = (ux * vy - uy * vx) / length;
  const cos = (ux * vx + uy * vy) / length;
  // Half the inside angle is a right angle minus half the turn: tan = cot(turn / 2).
  return sin > 0 && cos <= maxTurnCosine ? (1 + cos) / sin : 0;
}

/**
 * Distances along an edge of `length` at which to sample it, starting with 0
 * (the vertex): every `spacing` millimetres, closer near a sharp corner at
 * either end (non-zero `startSlope` or `endSlope`, see `cornerSlope`). Where a
 * wedge is narrower than the spacing, the Delaunay triangles across it are
 * slivers whose circumcentres fall outside the area, and the axis would stop
 * short of the tip; graded samples keep the spacing within the wedge's width
 * down to `CORNER_RESOLUTION` from the corner.
 */
function edgeSamples(
  length: number,
  spacing: number,
  startSlope: number,
  endSlope: number,
): number[] {
  const graded = (slope: number) => {
    const result: number[] = [];
    if (slope === 0) return result;
    for (let d = CORNER_RESOLUTION; d < length / 2; ) {
      const step = d * slope * CORNER_GRADING;
      if (step >= spacing) break;
      result.push(d);
      d += step;
    }
    return result;
  };
  const fromStart = graded(startSlope);
  const fromEnd = graded(endSlope);
  const lo = fromStart.at(-1) ?? 0;
  const hi = length - (fromEnd.at(-1) ?? 0);
  const steps = Math.max(1, Math.ceil((hi - lo) / spacing));
  const uniform = Array.from({ length: steps - 1 }, (_, j) => lo + ((hi - lo) * (j + 1)) / steps);
  return [
    0,
    ...fromStart,
    ...uniform,
    ...(fromEnd.length ? [hi] : []),
    ...fromEnd
      .slice(0, -1)
      .reverse()
      .map((d) => length - d),
  ];
}

/** The empty circumcircles of the Delaunay triangles of the samples, and which lie inside the area. */
class Disks {
  readonly triangles: Uint32Array;
  readonly halfedges: Int32Array;
  readonly x: Float64Array;
  readonly y: Float64Array;
  /** Circumradius: the distance to the triangle's samples. */
  readonly circumradius: Float64Array;
  /** Distance to the nearest edge, at most the circumradius. */
  readonly radius: Float64Array;
  readonly inside: Uint8Array;

  constructor(readonly boundary: Boundary) {
    const { coords } = boundary;
    const { triangles, halfedges } = new Delaunator(coords);
    this.triangles = triangles;
    this.halfedges = halfedges;
    const count = triangles.length / 3;
    this.x = new Float64Array(count);
    this.y = new Float64Array(count);
    this.circumradius = new Float64Array(count);
    this.radius = new Float64Array(count);
    this.inside = new Uint8Array(count);
    for (let t = 0; t < count; t++) {
      const a = triangles[3 * t] as number;
      const b = triangles[3 * t + 1] as number;
      const c = triangles[3 * t + 2] as number;
      const ax = coords[2 * a] as number;
      const ay = coords[2 * a + 1] as number;
      const bx = (coords[2 * b] as number) - ax;
      const by = (coords[2 * b + 1] as number) - ay;
      const cx = (coords[2 * c] as number) - ax;
      const cy = (coords[2 * c + 1] as number) - ay;
      const d = 2 * (bx * cy - by * cx);
      if (d === 0) continue;
      const b2 = bx * bx + by * by;
      const c2 = cx * cx + cy * cy;
      const ux = (cy * b2 - by * c2) / d;
      const uy = (bx * c2 - cx * b2) / d;
      const x = ax + ux;
      const y = ay + uy;
      // The circle is empty, so it touches the boundary from one side; a vote
      // settles circles so small that one sample's test is noisy.
      const votes =
        Number(boundary.inside(a, x, y)) +
        Number(boundary.inside(b, x, y)) +
        Number(boundary.inside(c, x, y));
      if (votes < 2) continue;
      this.inside[t] = 1;
      this.x[t] = x;
      this.y[t] = y;
      this.circumradius[t] = Math.hypot(ux, uy);
      this.radius[t] = Math.min(
        boundary.distance(a, x, y),
        boundary.distance(b, x, y),
        boundary.distance(c, x, y),
      );
    }
  }
}

/** Disk centres (triangles first, then corner points) and the axis edges between them. */
class Graph {
  readonly x: number[];
  readonly y: number[];
  readonly radius: number[];
  readonly edges: [number, number][] = [];

  constructor(disks: Disks) {
    this.x = Array.from(disks.x);
    this.y = Array.from(disks.y);
    this.radius = Array.from(disks.radius);
  }

  addNode(x: number, y: number, radius: number): number {
    this.x.push(x);
    this.y.push(y);
    this.radius.push(radius);
    return this.x.length - 1;
  }

  /** Chains the edges into branches between nodes that are not on a plain run, specks left out. */
  branches(): MedialAxisBranch[] {
    const node = this.mergeCoincident();
    const neighbours = new Map<number, Set<number>>();
    const link = (a: number, b: number) => {
      const set = neighbours.get(a) ?? new Set<number>();
      set.add(b);
      neighbours.set(a, set);
    };
    for (const [a0, b0] of this.edges) {
      const a = node(a0);
      const b = node(b0);
      if (a === b) continue;
      link(a, b);
      link(b, a);
    }
    this.settleSpecks(neighbours);
    const walked = new Set<string>();
    const key = (a: number, b: number) => (a < b ? `${a},${b}` : `${b},${a}`);
    const result: MedialAxisBranch[] = [];
    const walk = (start: number, next: number) => {
      const ids = [start];
      let previous = start;
      let current = next;
      walked.add(key(previous, current));
      for (;;) {
        ids.push(current);
        const around = neighbours.get(current);
        if (current === start || !around || around.size !== 2) break;
        let following = -1;
        for (const n of around) if (n !== previous) following = n;
        if (walked.has(key(current, following))) break;
        walked.add(key(current, following));
        previous = current;
        current = following;
      }
      result.push({
        points: ids.map((i) => [this.x[i], this.y[i]] as Point),
        radii: ids.map((i) => this.radius[i] as number),
      });
    };
    // Branches between ends and junctions first, then closed loops.
    for (const [a, around] of neighbours) {
      if (around.size === 2) continue;
      for (const b of around) if (!walked.has(key(a, b))) walk(a, b);
    }
    for (const [a, around] of neighbours) {
      for (const b of around) if (!walked.has(key(a, b))) walk(a, b);
    }
    return result;
  }

  /**
   * Settles the parts of the axis whose disks are all under
   * `MIN_COMPONENT_RADIUS`: one within that distance of the rest of the axis
   * is joined to it at its nearest node (the tip of a corner sharper than the
   * sampling links up to the axis that way); any other is a speck graded
   * sampling grew at a step of a drawn edge (rounded coordinates, dense
   * polylines), which would be carved as a run of its own cutting nothing,
   * and goes.
   */
  private settleSpecks(neighbours: Map<number, Set<number>>) {
    const component = new Map<number, number>();
    const specks: number[][] = [];
    for (const start of neighbours.keys()) {
      if (component.has(start)) continue;
      const nodes = [start];
      component.set(start, start);
      let largest = 0;
      for (let k = 0; k < nodes.length; k++) {
        const n = nodes[k] as number;
        largest = Math.max(largest, this.radius[n] as number);
        for (const m of neighbours.get(n) ?? []) {
          if (!component.has(m)) {
            component.set(m, start);
            nodes.push(m);
          }
        }
      }
      if (largest < MIN_COMPONENT_RADIUS) specks.push(nodes);
    }
    if (specks.length === 0) return;

    const size = MIN_COMPONENT_RADIUS;
    const cellOf = (n: number) =>
      [Math.floor((this.x[n] as number) / size), Math.floor((this.y[n] as number) / size)] as const;
    const cells = new Map<string, number[]>();
    for (const n of neighbours.keys()) {
      const [cx, cy] = cellOf(n);
      const key = `${cx},${cy}`;
      const list = cells.get(key);
      if (list) list.push(n);
      else cells.set(key, [n]);
    }
    for (const nodes of specks) {
      const own = component.get(nodes[0] as number);
      let best: [number, number] | null = null;
      let bestDistance = size;
      for (const n of nodes) {
        const [cx, cy] = cellOf(n);
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            for (const m of cells.get(`${cx + dx},${cy + dy}`) ?? []) {
              if (component.get(m) === own) continue;
              const d = Math.hypot(
                (this.x[n] as number) - (this.x[m] as number),
                (this.y[n] as number) - (this.y[m] as number),
              );
              if (d < bestDistance) {
                bestDistance = d;
                best = [n, m];
              }
            }
          }
        }
      }
      if (best) {
        const [n, m] = best;
        neighbours.get(n)?.add(m);
        neighbours.get(m)?.add(n);
        // Joined pieces are one: a later speck may join this one.
        const joined = component.get(m) as number;
        for (const node of nodes) component.set(node, joined);
      } else {
        for (const n of nodes) neighbours.delete(n);
      }
    }
  }

  /** Joins nodes that coincide (cocircular samples share a circumcentre); returns each node's representative. */
  private mergeCoincident(): (i: number) => number {
    const parent = this.x.map((_, i) => i);
    const find = (i: number): number => {
      let root = i;
      while (parent[root] !== root) root = parent[root] as number;
      while (parent[i] !== root) {
        const up = parent[i] as number;
        parent[i] = root;
        i = up;
      }
      return root;
    };
    for (const [a, b] of this.edges) {
      const ax = this.x[a] as number;
      const ay = this.y[a] as number;
      if (Math.hypot(ax - (this.x[b] as number), ay - (this.y[b] as number)) >= MERGE_DISTANCE) {
        continue;
      }
      const ra = find(a);
      const rb = find(b);
      if (ra === rb) continue;
      parent[rb] = ra;
      this.radius[ra] = Math.min(this.radius[ra] as number, this.radius[rb] as number);
    }
    return find;
  }
}

/**
 * Adds the Voronoi edges between neighbouring inside disks whose shared
 * samples lie on different edges and subtend at least the minimum angle:
 * the others are spurs pointing at the boundary between two samples.
 */
function joinVoronoiEdges(graph: Graph, disks: Disks, minHalfSine: number) {
  const { triangles, halfedges, inside, circumradius, boundary } = disks;
  const { coords } = boundary;
  for (let e = 0; e < halfedges.length; e++) {
    const o = halfedges[e] as number;
    if (o < e) continue;
    const t1 = Math.floor(e / 3);
    const t2 = Math.floor(o / 3);
    if (!inside[t1] || !inside[t2]) continue;
    const p = triangles[e] as number;
    const q = triangles[e % 3 === 2 ? e - 2 : e + 1] as number;
    if (boundary.shareEdge(p, q)) continue;
    const chord = Math.hypot(
      (coords[2 * p] as number) - (coords[2 * q] as number),
      (coords[2 * p + 1] as number) - (coords[2 * q + 1] as number),
    );
    const far = Math.max(circumradius[t1] as number, circumradius[t2] as number);
    if (chord < 2 * far * minHalfSine) continue;
    graph.edges.push([t1, t2]);
  }
}

/**
 * Extends the axis into each sharp convex corner: the smallest inside disk
 * touching the corner is joined to the corner itself, at radius 0, so the
 * V-bit carves right into it.
 */
function joinCorners(graph: Graph, disks: Disks) {
  const { triangles, inside, circumradius, boundary } = disks;
  const smallest = new Map<number, number>();
  for (let t = 0; t < inside.length; t++) {
    if (!inside[t]) continue;
    for (let k = 0; k < 3; k++) {
      const s = triangles[3 * t + k] as number;
      if (!boundary.isVertex[s] || !boundary.startsAtSharpCorner[boundary.edge[s] as number])
        continue;
      const current = smallest.get(s);
      if (
        current === undefined ||
        (circumradius[t] as number) < (circumradius[current] as number)
      ) {
        smallest.set(s, t);
      }
    }
  }
  for (const [s, t] of smallest) {
    const corner = graph.addNode(
      boundary.coords[2 * s] as number,
      boundary.coords[2 * s + 1] as number,
      0,
    );
    graph.edges.push([t, corner]);
  }
}
