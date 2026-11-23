import { TELEMETRY_EVENTS } from "@furrow/workspace/lib/telemetry";

/**
 * What PostHog may learn about the page (ADR-0052, as ADR-0020 before it):
 * the route pattern, never the concrete URL with its IDs, query string or
 * hash, and on the first page view only an external referrer's origin.
 * With the visitor's consent, autocapture adds which element was used, by
 * its own anchors and never its text (ADR-0093).
 */

/** Asks the consent prompt to open again, from the footer or the account menu. */
export const USAGE_SETTINGS_EVENT = "furrow:usage-settings";
export function openUsageSettings() {
  window.dispatchEvent(new Event(USAGE_SETTINGS_EVENT));
}

/** All a visitor who hasn't agreed sends: page views, errors and the workspace's events. */
export function sentWithoutConsent(event: string) {
  return event === "$pageview" || event === "$exception" || TELEMETRY_EVENTS.includes(event);
}

/** Attributes that may hold names the user typed: tooltips, labels, input values. */
const TEXT_ATTRIBUTE = /^(title|alt|placeholder|label|download|value)$|^aria-/;

/**
 * An attribute's value as session replay may record it: masked when it may
 * hold the user's text, as replay already masks every text node and input.
 */
export function maskReplayAttribute(name: string, value: string) {
  return TEXT_ATTRIBUTE.test(name) ? "*".repeat(value.length) : value;
}

/** An element's fields autocapture may send: its tag, position and our own anchors. */
const KEPT_ELEMENT_FIELD =
  /^(tag_name|nth_child|nth_of_type|attr__(data-tour|data-demo|data-slot|id|role|type))$/;
/** Properties derived from an element's text, link or the text the visitor copied. */
const ELEMENT_TEXT_PROPERTY = /^\$(el_text|elements_chain|external_click_url|selected_content)$/;

/**
 * The properties without any element's text, classes or other attributes,
 * which may hold names the user typed (a `title` tooltip, a link to a
 * project). PostHog builds the elements chain from the kept `$elements`.
 */
export function scrubElements(properties: Record<string, unknown>): Record<string, unknown> {
  const kept = Object.fromEntries(
    Object.entries(properties).filter(([key]) => !ELEMENT_TEXT_PROPERTY.test(key)),
  );
  if (Array.isArray(kept.$elements)) {
    kept.$elements = kept.$elements.map((element: unknown) =>
      typeof element === "object" && element !== null
        ? Object.fromEntries(
            Object.entries(element).filter(([key]) => KEPT_ELEMENT_FIELD.test(key)),
          )
        : {},
    );
  }
  return kept;
}

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
