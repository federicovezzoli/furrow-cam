import { distance, GEOMETRY_TOLERANCE, type Point } from "@furrow/document";

/** A point in homogeneous coordinates `[w·x, w·y, w]`. */
type Homogeneous = [number, number, number];

export type BSpline = {
  degree: number;
  knots: number[];
  controlPoints: Point[];
  /** One per control point; omitted or all equal for a non-rational spline. */
  weights?: number[];
};

/** A cubic Bézier from the previous point, or a line when the spline has degree 1. */
export type SplineSegment =
  | { kind: "line"; to: Point }
  | { kind: "cubic"; c1: Point; c2: Point; to: Point };

/** Halvings of a rational or high-degree piece before its cubic is accepted as it is. */
const MAX_SUBDIVISIONS = 12;

/** Parameters at which an approximating cubic is compared with the curve. */
const CHECKS = [0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875];

/**
 * Converts a B-spline to lines and cubic Béziers from its first point, or
 * returns `null` if its knots, weights or control points don't make a spline.
 * Non-rational splines of degree 1 to 3 are converted exactly; rational and
 * higher-degree ones are approximated by cubics within `GEOMETRY_TOLERANCE`.
 */
export function splineToSegments(
  spline: BSpline,
): { start: Point; segments: SplineSegment[] } | null {
  const { degree: p, knots, controlPoints } = spline;
  const n = controlPoints.length;
  if (!Number.isInteger(p) || p < 1 || n < p + 1 || knots.length !== n + p + 1) return null;
  if (
    !knots.every(Number.isFinite) ||
    knots.some((knot, i) => i > 0 && knot < (knots[i - 1] as number))
  ) {
    return null;
  }
  const weights = spline.weights && spline.weights.length === n ? spline.weights : undefined;
  if (weights?.some((w) => !(w > 0))) return null;
  const rational = weights?.some((w) => w !== weights[0]) === true;
  const points: Homogeneous[] = controlPoints.map(([x, y], i) => {
    const w = rational ? (weights?.[i] as number) : 1;
    return [x * w, y * w, w];
  });

  const pieces = bezierPieces(p, [...knots], points);
  if (pieces.length === 0) return null;
  const start = project((pieces[0] as Homogeneous[])[0] as Homogeneous);
  const segments: SplineSegment[] = [];
  for (const piece of pieces) {
    if (!rational && p === 1) {
      segments.push({ kind: "line", to: project(piece[1] as Homogeneous) });
    } else if (!rational && p === 2) {
      // Degree elevation: a quadratic is exactly a cubic.
      const [q0, q1, q2] = piece.map(project) as [Point, Point, Point];
      segments.push({
        kind: "cubic",
        c1: lerp(q0, q1, 2 / 3),
        c2: lerp(q2, q1, 2 / 3),
        to: q2,
      });
    } else if (!rational && p === 3) {
      const [, c1, c2, to] = piece.map(project) as [Point, Point, Point, Point];
      segments.push({ kind: "cubic", c1, c2, to });
    } else {
      approximate(piece, 0, 1, 0, segments);
    }
  }
  return { start, segments };
}

/**
 * Splits a B-spline into Bézier pieces, one per non-empty knot span of its
 * domain. Each piece has `p + 1` control points. A span depends only on the
 * `p + 1` control points and `2p + 2` knots around it, so each is converted
 * on its own (`spanBezier`), in time linear in the size of the spline.
 */
function bezierPieces(p: number, knots: number[], points: Homogeneous[]): Homogeneous[][] {
  const pieces: Homogeneous[][] = [];
  for (let i = p; i < points.length; i++) {
    if (!((knots[i + 1] as number) > (knots[i] as number))) continue;
    pieces.push(spanBezier(p, knots.slice(i - p, i + p + 2), points.slice(i - p, i + 1)));
  }
  return pieces;
}

/**
 * The Bézier control points of a B-spline with `p + 1` control points, whose
 * domain is the single span `[knots[p], knots[p + 1]]`: both ends are
 * inserted until they have multiplicity `p` (Boehm's algorithm).
 */
function spanBezier(p: number, knots: number[], points: Homogeneous[]): Homogeneous[] {
  for (const u of [knots[p] as number, knots[p + 1] as number]) {
    let multiplicity = knots.filter((knot) => knot === u).length;
    while (multiplicity < p) {
      insertKnot(p, knots, points, u);
      multiplicity++;
    }
  }
  // The span is the only non-empty one in the domain, now with its Bézier points around it.
  let i = p;
  while (!((knots[i + 1] as number) > (knots[i] as number))) i++;
  return points.slice(i - p, i + 1);
}

/** Inserts `u` once, in place, into the last span that starts at or before it, within the domain. */
function insertKnot(p: number, knots: number[], points: Homogeneous[], u: number) {
  // The span `[knots[k], knots[k + 1]]` with `u` in it; at the domain's end, the last non-empty span.
  let k = p;
  while (k + 1 < points.length && (knots[k + 1] as number) <= u) k++;
  while (
    k > p &&
    (knots[k] as number) === u &&
    (knots[k] as number) === (knots[points.length] as number)
  ) {
    k--;
  }
  const inserted: Homogeneous[] = [];
  for (let j = k - p + 1; j <= k; j++) {
    const tj = knots[j] as number;
    const alpha = (u - tj) / ((knots[j + p] as number) - tj);
    const a = points[j - 1] as Homogeneous;
    const b = points[j] as Homogeneous;
    inserted.push([
      (1 - alpha) * a[0] + alpha * b[0],
      (1 - alpha) * a[1] + alpha * b[1],
      (1 - alpha) * a[2] + alpha * b[2],
    ]);
  }
  points.splice(k - p + 1, p - 1, ...inserted);
  knots.splice(k + 1, 0, u);
}

/** Appends cubics within `GEOMETRY_TOLERANCE` of the rational Bézier `piece` from `t0` to `t1`. */
function approximate(
  piece: Homogeneous[],
  t0: number,
  t1: number,
  depth: number,
  segments: SplineSegment[],
) {
  const [p0, d0] = pointAndDerivative(piece, t0);
  const [p1, d1] = pointAndDerivative(piece, t1);
  const h = (t1 - t0) / 3;
  const c1: Point = [p0[0] + d0[0] * h, p0[1] + d0[1] * h];
  const c2: Point = [p1[0] - d1[0] * h, p1[1] - d1[1] * h];
  const fits = CHECKS.every((s) => {
    const curve = pointAndDerivative(piece, t0 + s * (t1 - t0))[0];
    return distance(curve, cubicAt(p0, c1, c2, p1, s)) <= GEOMETRY_TOLERANCE;
  });
  if (fits || depth >= MAX_SUBDIVISIONS) {
    segments.push({ kind: "cubic", c1, c2, to: p1 });
    return;
  }
  const middle = (t0 + t1) / 2;
  approximate(piece, t0, middle, depth + 1, segments);
  approximate(piece, middle, t1, depth + 1, segments);
}

/** The point at `t` on a rational Bézier and its derivative, by de Casteljau. */
function pointAndDerivative(piece: Homogeneous[], t: number): [Point, Point] {
  let level = piece.map((point): Homogeneous => [...point]);
  // Stop one step early: the last two points give both the point and the tangent.
  while (level.length > 2) {
    const next: Homogeneous[] = [];
    for (let i = 0; i + 1 < level.length; i++)
      next.push(mix(level[i] as Homogeneous, level[i + 1] as Homogeneous, t));
    level = next;
  }
  const a = level[0] as Homogeneous;
  const b = level[1] as Homogeneous;
  const point = mix(a, b, t);
  const degree = piece.length - 1;
  const derivative: Homogeneous = [
    degree * (b[0] - a[0]),
    degree * (b[1] - a[1]),
    degree * (b[2] - a[2]),
  ];
  const [x, y, w] = point;
  // The quotient rule: (A / w)' = (A' w - A w') / w².
  return [
    [x / w, y / w],
    [
      (derivative[0] * w - x * derivative[2]) / (w * w),
      (derivative[1] * w - y * derivative[2]) / (w * w),
    ],
  ];
}

function mix(a: Homogeneous, b: Homogeneous, t: number): Homogeneous {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function project([x, y, w]: Homogeneous): Point {
  return [x / w, y / w];
}

function lerp(a: Point, b: Point, t: number): Point {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

function cubicAt(p0: Point, c1: Point, c2: Point, p1: Point, t: number): Point {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return [
    a * p0[0] + b * c1[0] + c * c2[0] + d * p1[0],
    a * p0[1] + b * c1[1] + c * c2[1] + d * p1[1],
  ];
}

/** The point at `u` on a B-spline, by de Boor, for tests. */
export function splineAt(spline: BSpline, u: number): Point {
  const { degree: p, knots, controlPoints, weights } = spline;
  const n = controlPoints.length;
  let k = p;
  while (k + 1 < n && (knots[k + 1] as number) <= u) k++;
  const d: Homogeneous[] = [];
  for (let j = 0; j <= p; j++) {
    const [x, y] = controlPoints[j + k - p] as Point;
    const w = weights?.[j + k - p] ?? 1;
    d.push([x * w, y * w, w]);
  }
  for (let r = 1; r <= p; r++) {
    for (let j = p; j >= r; j--) {
      const i = j + k - p;
      const ti = knots[i] as number;
      const alpha = (u - ti) / ((knots[i + p - r + 1] as number) - ti);
      d[j] = mix(d[j - 1] as Homogeneous, d[j] as Homogeneous, alpha);
    }
  }
  return project(d[p] as Homogeneous);
}
