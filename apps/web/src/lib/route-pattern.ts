type Params = Record<string, string | string[] | undefined>;

/**
 * The route pattern of a pathname, e.g. `/projects/[id]` for `/projects/abc123`: each segment
 * that holds a dynamic param value is replaced by the param's name, so analytics count routes
 * and never send record IDs (ADR-0020). Catch-all values become `[...name]`.
 *
 * Params come in route order, so they are matched from the deepest one backwards against the
 * rightmost equal run of segments: a static segment never shadows a param with the same value.
 */
export function routePattern(pathname: string, params: Params): string {
  const segments = pathname.split("/");
  for (const [name, value] of Object.entries(params).reverse()) {
    if (value === undefined) continue;
    const values = (Array.isArray(value) ? value : [value]).map(decode);
    if (values.length === 0) continue;
    const start = lastIndexOfRun(segments, values);
    if (start === -1) continue;
    const placeholder = Array.isArray(value) ? `[...${name}]` : `[${name}]`;
    segments.splice(start, values.length, placeholder);
  }
  return segments.join("/");
}

// Compare decoded forms: the pathname is percent-encoded, param values may or may not be.
function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function lastIndexOfRun(segments: string[], run: string[]): number {
  for (let i = segments.length - run.length; i >= 0; i--) {
    if (run.every((value, j) => decode(segments[i + j]) === value)) return i;
  }
  return -1;
}
