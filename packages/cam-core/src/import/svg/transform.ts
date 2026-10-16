import type { Point } from "@furrow/document";
import { parseNumbers } from "./number";

/** An affine transform `[a, b, c, d, e, f]`, as in SVG's `matrix(a b c d e f)`. */
export type Matrix = readonly [number, number, number, number, number, number];

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** `m × n`: applies `n` first, then `m`. */
export function multiply(m: Matrix, n: Matrix): Matrix {
  const [a, b, c, d, e, f] = m;
  const [a2, b2, c2, d2, e2, f2] = n;
  return [
    a * a2 + c * b2,
    b * a2 + d * b2,
    a * c2 + c * d2,
    b * c2 + d * d2,
    a * e2 + c * f2 + e,
    b * e2 + d * f2 + f,
  ];
}

export function apply(m: Matrix, [x, y]: Point): Point {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

export function translation(x: number, y: number): Matrix {
  return [1, 0, 0, 1, x, y];
}

export function determinant(m: Matrix): number {
  return m[0] * m[3] - m[1] * m[2];
}

/**
 * Whether `m` keeps circles circular: a rotation, uniform scale and
 * translation, possibly mirrored.
 */
export function isSimilarity(m: Matrix): boolean {
  const [a, b, c, d] = m;
  const sx = a * a + b * b;
  const sy = c * c + d * d;
  const scale = Math.max(sx, sy);
  return scale > 0 && Math.abs(sx - sy) <= 1e-9 * scale && Math.abs(a * c + b * d) <= 1e-9 * scale;
}

const TRANSFORM = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;

/**
 * Parses an SVG `transform` attribute. Returns `null` if it isn't valid, in
 * which case SVG renders the element untransformed.
 */
export function parseTransform(text: string): Matrix | null {
  let result = IDENTITY;
  for (const match of text.matchAll(TRANSFORM)) {
    const args = parseNumbers(match[2] ?? "");
    const [x = 0, y, z] = args;
    let m: Matrix;
    switch (match[1]) {
      case "matrix":
        if (args.length !== 6) return null;
        m = args as unknown as Matrix;
        break;
      case "translate":
        m = translation(x, y ?? 0);
        break;
      case "scale":
        m = [x, 0, 0, y ?? x, 0, 0];
        break;
      case "rotate": {
        const angle = (x * Math.PI) / 180;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        m = [cos, sin, -sin, cos, 0, 0];
        if (y !== undefined && z !== undefined) {
          m = multiply(multiply(translation(y, z), m), translation(-y, -z));
        }
        break;
      }
      case "skewX":
        m = [1, 0, Math.tan((x * Math.PI) / 180), 1, 0, 0];
        break;
      default:
        m = [1, Math.tan((x * Math.PI) / 180), 0, 1, 0, 0];
    }
    result = multiply(result, m);
  }
  // Anything but separators left over means the list is malformed.
  const rest = text.replace(TRANSFORM, "").replace(/[\s,]/g, "");
  if (rest !== "") return null;
  return result;
}
