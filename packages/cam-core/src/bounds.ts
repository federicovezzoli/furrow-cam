import { distance, type Path, type Point, pointsCoincide, type Shape } from "@furrow/document";

/** An axis-aligned rectangle. */
export type Rect = { min: Point; max: Point };

/**
 * The exact bounding box of a path: arcs and cubics count where they bulge
 * past their end points, not where a flattening would put them.
 */
export function pathBounds(path: Path): Rect {
  const min: Point = [...path.start];
  const max: Point = [...path.start];
  const add = ([x, y]: Point) => {
    min[0] = Math.min(min[0], x);
    min[1] = Math.min(min[1], y);
    max[0] = Math.max(max[0], x);
    max[1] = Math.max(max[1], y);
  };
  let current = path.start;
  for (const segment of path.segments) {
    if (segment.kind === "arc") {
      for (const point of arcExtremes(current, segment.to, segment.center, segment.clockwise)) {
        add(point);
      }
    } else if (segment.kind === "cubic") {
      for (const point of cubicExtremes(current, segment.c1, segment.c2, segment.to)) add(point);
    }
    add(segment.to);
    current = segment.to;
  }
  return { min, max };
}

/** The bounding box of every path of `shapes`, or `null` if there are none. */
export function shapesBounds(shapes: Shape[]): Rect | null {
  let bounds: Rect | null = null;
  for (const shape of shapes) {
    for (const path of shape.paths) {
      const { min, max } = pathBounds(path);
      bounds = bounds
        ? {
            min: [Math.min(bounds.min[0], min[0]), Math.min(bounds.min[1], min[1])],
            max: [Math.max(bounds.max[0], max[0]), Math.max(bounds.max[1], max[1])],
          }
        : { min, max };
    }
  }
  return bounds;
}

const TURN = 2 * Math.PI;

/** The points where an arc is furthest left, right, down or up, if it gets there. */
function arcExtremes(from: Point, to: Point, center: Point, clockwise: boolean): Point[] {
  const radius = distance(center, from);
  const angle = ([x, y]: Point) => Math.atan2(y - center[1], x - center[0]);
  // How far round the arc goes from its start to `theta`, in its own direction.
  const along = (theta: number) => {
    const turn = clockwise ? angle(from) - theta : theta - angle(from);
    return ((turn % TURN) + TURN) % TURN;
  };
  const full = pointsCoincide(from, to);
  const sweep = along(angle(to));
  const extremes: Point[] = [];
  for (const [dx, dy] of [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
  ] as const) {
    if (full || along(Math.atan2(dy, dx)) <= sweep) {
      extremes.push([center[0] + dx * radius, center[1] + dy * radius]);
    }
  }
  return extremes;
}

/** The points inside a cubic where it turns back along X or Y. */
function cubicExtremes(p0: Point, p1: Point, p2: Point, p3: Point): Point[] {
  const at = (t: number): Point => {
    const s = 1 - t;
    const [a, b, c, d] = [s * s * s, 3 * s * s * t, 3 * s * t * t, t * t * t];
    return [
      a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
      a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1],
    ];
  };
  const extremes: Point[] = [];
  for (const axis of [0, 1] as const) {
    // The derivative is a quadratic in t: qa t² + qb t + qc, up to a factor of 3.
    const a = p1[axis] - p0[axis];
    const b = p2[axis] - p1[axis];
    const c = p3[axis] - p2[axis];
    const qa = a - 2 * b + c;
    const qb = 2 * (b - a);
    const qc = a;
    const roots: number[] = [];
    if (qa === 0) {
      if (qb !== 0) roots.push(-qc / qb);
    } else {
      const discriminant = qb * qb - 4 * qa * qc;
      if (discriminant >= 0) {
        const root = Math.sqrt(discriminant);
        roots.push((-qb + root) / (2 * qa), (-qb - root) / (2 * qa));
      }
    }
    for (const t of roots) if (t > 0 && t < 1) extremes.push(at(t));
  }
  return extremes;
}
