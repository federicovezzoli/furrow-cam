/** At most 3 decimals (a micrometre), without trailing zeros or `-0`. */
export function formatNumber(value: number): string {
  const text = value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
  return text === "-0" ? "0" : text;
}
