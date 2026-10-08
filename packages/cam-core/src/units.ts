import type { Units } from "@furrow/document";

const MM_PER_INCH = 25.4;

/** Converts a length in the given units to millimetres, the internal unit (ADR-0007). */
export function toMillimetres(value: number, units: Units): number {
  return units === "in" ? value * MM_PER_INCH : value;
}

/** Converts a length in millimetres to the given units. */
export function fromMillimetres(value: number, units: Units): number {
  return units === "in" ? value / MM_PER_INCH : value;
}
