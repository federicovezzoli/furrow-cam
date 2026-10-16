/** Imported coordinates are rounded to a nanometre, dropping float noise from transforms. */
export function roundCoordinate(value: number): number {
  // Adding 0 turns -0 into 0.
  return Math.round(value * 1e9) / 1e9 + 0;
}
