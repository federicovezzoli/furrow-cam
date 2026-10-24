/** Affine transforms in 3D, as row-major 3 × 4 matrices: each row holds the factors of `x`, `y` and `z`, then the offset. */

/** `point` moved by `matrix`. */
export function applyAffine(
  matrix: readonly number[],
  [x, y, z]: readonly [number, number, number],
): [number, number, number] {
  const row = (r: number) =>
    (matrix[r * 4] as number) * x +
    (matrix[r * 4 + 1] as number) * y +
    (matrix[r * 4 + 2] as number) * z +
    (matrix[r * 4 + 3] as number) +
    0;
  return [row(0), row(1), row(2)];
}

/** The transform that applies `inner`, then `outer`. */
export function composeAffine(outer: readonly number[], inner: readonly number[]): number[] {
  const matrix: number[] = [];
  for (let row = 0; row < 3; row++) {
    for (let column = 0; column < 4; column++) {
      let sum = column === 3 ? (outer[row * 4 + 3] as number) : 0;
      for (let k = 0; k < 3; k++) {
        sum += (outer[row * 4 + k] as number) * (inner[k * 4 + column] as number);
      }
      // `+ 0` turns -0 into 0, so equal transforms compare equal.
      matrix.push(sum + 0);
    }
  }
  return matrix;
}
