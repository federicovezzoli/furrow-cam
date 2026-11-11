import type { Point } from "@furrow/document";
import { containmentIn, signedArea } from "../geometry/clipper";
import { triangulate } from "../geometry/triangulate";
import { binaryStlTriangles, type StlLimits } from "./stl/import";

// A grid of heights as a closed mesh: terrain (ADR-0077) and image reliefs (PRD-0015).

/** The most triangles `limits` let a binary STL hold. */
export function triangleBudget(limits: StlLimits): number {
  return Math.min(limits.maxTriangles, binaryStlTriangles(limits.maxBytes));
}

/** A grid of `nx` × `ny` cells, each `cell` mm wide and deep, and which of them are kept. */
export type HeightGrid = {
  nx: number;
  ny: number;
  cell: readonly [number, number];
  /** 1 for each cell kept, row by row; a cell touching the rest only at a corner must not be. */
  inside: Uint8Array;
  /** The top's height in mm at each of the `(nx + 1) × (ny + 1)` corners, row by row. */
  top: ArrayLike<number>;
};

/**
 * The kept cells of `grid` as a closed mesh, in mm from the grid's corner:
 * the top, the walls along the kept cells' outline and a flat bottom at 0.
 */
export function heightGridMesh({ nx, ny, cell, inside, top: heights }: HeightGrid) {
  const columns = nx + 1;
  const vertex = (i: number, j: number) => j * columns + i;
  const at = (i: number, j: number) =>
    i >= 0 && j >= 0 && i < nx && j < ny && inside[j * nx + i] === 1;

  const positions: number[] = [];
  const indices: number[] = [];
  const add = (x: number, y: number, z: number) => {
    positions.push(x, y, z);
    return positions.length / 3 - 1;
  };
  const xy = (v: number): Point => [(v % columns) * cell[0], Math.floor(v / columns) * cell[1]];

  // A top vertex at each corner of a kept cell.
  const top = new Int32Array(columns * (ny + 1)).fill(-1);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      if (!at(i, j)) continue;
      for (const v of [vertex(i, j), vertex(i + 1, j), vertex(i, j + 1), vertex(i + 1, j + 1)]) {
        if (top[v] === -1) top[v] = add(...xy(v), heights[v] as number);
      }
    }
  }
  const t = (v: number) => top[v] as number;

  // The top: two triangles per cell, counter-clockwise from above. The
  // outline: each side of a cell inside with no cell beyond, the inside on
  // its left, so outer loops run counter-clockwise and holes clockwise.
  const next = new Int32Array(top.length).fill(-1);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      if (!at(i, j)) continue;
      const a = vertex(i, j);
      const b = vertex(i + 1, j);
      const c = vertex(i + 1, j + 1);
      const d = vertex(i, j + 1);
      indices.push(t(a), t(b), t(c), t(a), t(c), t(d));
      if (!at(i, j - 1)) next[a] = b;
      if (!at(i + 1, j)) next[b] = c;
      if (!at(i, j + 1)) next[c] = d;
      if (!at(i - 1, j)) next[d] = a;
    }
  }

  // The walls, facing out, down to a bottom vertex under each outline vertex.
  const bottom = new Int32Array(top.length).fill(-1);
  next.forEach((to, v) => {
    if (to >= 0) bottom[v] = add(...xy(v), 0);
  });
  const b = (v: number) => bottom[v] as number;
  next.forEach((q, p) => {
    if (q >= 0) indices.push(b(p), b(q), t(q), b(p), t(q), t(p));
  });

  addBottom(outlineLoops(next), columns, xy, add, b, indices);
  return { positions, indices };
}

/**
 * Drops cells that touch the rest only at a corner, so every outline vertex
 * has one side in and one out and every edge of the mesh joins two faces.
 * Of the two diagonal cells, the one with fewer neighbours goes.
 */
export function dropCornerContacts(inside: Uint8Array, nx: number, ny: number) {
  const at = (i: number, j: number) =>
    i >= 0 && j >= 0 && i < nx && j < ny && inside[j * nx + i] === 1;
  const neighbours = (i: number, j: number) =>
    Number(at(i - 1, j)) + Number(at(i + 1, j)) + Number(at(i, j - 1)) + Number(at(i, j + 1));
  const drop = (p: [number, number], q: [number, number]) => {
    const [i, j] = neighbours(...p) <= neighbours(...q) ? p : q;
    inside[j * nx + i] = 0;
  };
  let changed = true;
  while (changed) {
    changed = false;
    for (let j = 0; j + 1 < ny; j++) {
      for (let i = 0; i + 1 < nx; i++) {
        const a = at(i, j);
        const b = at(i + 1, j);
        const c = at(i, j + 1);
        const d = at(i + 1, j + 1);
        if (a && d && !b && !c) drop([i, j], [i + 1, j + 1]);
        else if (b && c && !a && !d) drop([i + 1, j], [i, j + 1]);
        else continue;
        changed = true;
      }
    }
  }
}

/** The outline's loops of vertices, each in the order `next` links them. */
function outlineLoops(next: Int32Array): number[][] {
  const seen = new Uint8Array(next.length);
  const loops: number[][] = [];
  next.forEach((to, start) => {
    if (to < 0 || seen[start]) return;
    const loop: number[] = [];
    for (let v = start; !seen[v]; v = next[v] as number) {
      seen[v] = 1;
      loop.push(v);
    }
    loops.push(loop);
  });
  return loops;
}

/**
 * The flat bottom, facing down. Each outer loop and the holes inside it are
 * triangulated by their corners only; where a triangle's side runs along the
 * outline past other outline vertices, it is split around its centroid so it
 * shares every one of them with the walls.
 */
function addBottom(
  loops: number[][],
  columns: number,
  xy: (v: number) => Point,
  add: (x: number, y: number, z: number) => number,
  b: (v: number) => number,
  indices: number[],
) {
  const grid = (v: number): Point => [v % columns, Math.floor(v / columns)];
  const along = new Map<string, number[]>();
  const shapes = loops.map((loop) => {
    const corners = loop.filter((v, k) => {
      const [px, py] = grid(loop[(k + loop.length - 1) % loop.length] as number);
      const [x, y] = grid(v);
      const [qx, qy] = grid(loop[(k + 1) % loop.length] as number);
      return (x - px) * (qy - y) - (y - py) * (qx - x) !== 0;
    });
    // The outline vertices between each pair of consecutive corners, both ways.
    let k = loop.indexOf(corners[0] as number);
    corners.forEach((from, c) => {
      const to = corners[(c + 1) % corners.length] as number;
      const between: number[] = [];
      for (k = (k + 1) % loop.length; loop[k] !== to; k = (k + 1) % loop.length)
        between.push(loop[k] as number);
      along.set(`${from},${to}`, between);
      along.set(`${to},${from}`, [...between].reverse());
    });
    const points = corners.map(grid);
    return { corners, points, area: signedArea(points), contains: containmentIn(points) };
  });

  const outers = shapes.filter((shape) => shape.area > 0);
  const holesOf = new Map(outers.map((outer) => [outer, [] as typeof shapes]));
  for (const hole of shapes.filter((shape) => shape.area < 0)) {
    const point = hole.points[0] as Point;
    const around = outers
      .filter((outer) => outer.contains(point) === "inside")
      .sort((p, q) => p.area - q.area)[0];
    if (around) holesOf.get(around)?.push(hole);
  }

  for (const [outer, holes] of holesOf) {
    const vertices = [outer, ...holes].flatMap((shape) => shape.corners);
    const triangles = triangulate(
      outer.points,
      holes.map((hole) => hole.points),
    );
    for (let k = 0; k < triangles.length; k += 3) {
      let corner = [0, 1, 2].map((m) => vertices[triangles[k + m] as number] as number);
      // Clockwise from above, so the bottom faces down.
      if (signedArea(corner.map(grid)) > 0) corner = [corner[0], corner[2], corner[1]] as number[];
      const ring = corner.flatMap((v, m) => [
        v,
        ...(along.get(`${v},${corner[(m + 1) % 3]}`) ?? []),
      ]);
      if (ring.length === 3) {
        indices.push(b(ring[0] as number), b(ring[1] as number), b(ring[2] as number));
        continue;
      }
      const [cx, cy] = corner
        .map(xy)
        .reduce(([sx, sy], [x, y]) => [sx + x / 3, sy + y / 3], [0, 0]);
      const centre = add(cx, cy, 0);
      ring.forEach((v, m) => {
        indices.push(centre, b(v), b(ring[(m + 1) % ring.length] as number));
      });
    }
  }
}
