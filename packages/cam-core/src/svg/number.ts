/** An SVG number: optional sign, digits with an optional fraction or a bare fraction, optional exponent. */
export const NUMBER_PATTERN = String.raw`[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?`;

const NUMBERS = new RegExp(NUMBER_PATTERN, "g");

/** Every number in `text`, however it is separated. */
export function parseNumbers(text: string): number[] {
  return Array.from(text.matchAll(NUMBERS), (match) => Number(match[0]));
}
