/**
 * What PostHog may learn about the page (ADR-0052, as ADR-0020 before it):
 * the route pattern, never the concrete URL with its IDs, query string or
 * hash, and on the first page view only an external referrer's origin.
 */

/** The page an event is captured on, as the telemetry component last saw it. */
export type PageContext = {
  origin: string;
  /** The concrete pathname `pattern` was made from. */
  pathname: string;
  pattern: string;
  /** An external referrer's origin, sent with the first page view only. */
  referrer: string | null;
};

/** Every property PostHog fills from the location, the title or the referrer. */
const LOCATION_PROPERTY = /url|referr|pathname|title|host|search|hash|utm_|gclid|fbclid/i;

/**
 * The properties of an event about to be sent, without anything PostHog read
 * from the location: the route pattern takes its place, or only the origin
 * when the page has changed since `page` was taken.
 */
export function scrubProperties(
  event: string,
  properties: Record<string, unknown>,
  page: PageContext,
  pathname: string,
): Record<string, unknown> {
  const kept = Object.fromEntries(
    Object.entries(properties).filter(([key]) => !LOCATION_PROPERTY.test(key)),
  );
  const pattern = pathname === page.pathname ? page.pattern : null;
  kept.$current_url = pattern === null ? page.origin : `${page.origin}${pattern}`;
  if (pattern !== null) kept.$pathname = pattern;
  if (event === "$pageview" && page.referrer) kept.$referrer = page.referrer;
  return kept;
}

export function externalOrigin(referrer: string, ownOrigin: string): string | null {
  if (!referrer) return null;
  try {
    const { origin } = new URL(referrer);
    return origin === ownOrigin ? null : origin;
  } catch {
    return null;
  }
}

/**
 * The route pattern of a pathname, e.g. `/projects/[id]` for `/projects/abc123`: segments holding
 * a param value are replaced by the param's name. Not-found pages have no params, so their path
 * is sent as typed (ADR-0020).
 */
export function routePattern(
  pathname: string,
  params: Record<string, string | string[] | undefined>,
) {
  const names = new Map<string, string>();
  for (const [name, value] of Object.entries(params)) {
    if (typeof value !== "string") continue;
    names.set(value, `[${name}]`);
    names.set(encodeURIComponent(value), `[${name}]`);
  }
  return pathname
    .split("/")
    .map((segment) => names.get(segment) ?? segment)
    .join("/");
}
