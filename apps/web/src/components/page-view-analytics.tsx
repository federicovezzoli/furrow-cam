"use client";

import { useParams, usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * Page-view counting with GoatCounter (ADR-0020). Sends the hit itself instead of loading
 * count.js, which always adds the query string (e.g. a password-reset token) and the full
 * referrer. Every navigation, the first one included, is counted once, with only the route
 * pattern as path and title, an external referrer's origin, and the screen size.
 */
export function PageViewAnalytics({ endpoint }: { endpoint: string }) {
  const pathname = usePathname();
  const params = useParams();
  const isFirstView = useRef(true);

  // Keyed on the concrete pathname: moving between two projects is a navigation too.
  // biome-ignore lint/correctness/useExhaustiveDependencies: params change together with pathname
  useEffect(() => {
    const path = routePattern(pathname, params);
    const url = new URL(endpoint);
    url.searchParams.set("p", path);
    url.searchParams.set("t", path);
    const referrer = isFirstView.current ? externalOrigin(document.referrer) : null;
    isFirstView.current = false;
    if (referrer) url.searchParams.set("r", referrer);
    url.searchParams.set("s", `${screen.width},${screen.height},${devicePixelRatio || 1}`);
    navigator.sendBeacon(url);
  }, [endpoint, pathname]);

  return null;
}

function externalOrigin(referrer: string): string | null {
  if (!referrer) return null;
  try {
    const { origin } = new URL(referrer);
    return origin === location.origin ? null : origin;
  } catch {
    return null;
  }
}

/**
 * The route pattern of a pathname, e.g. `/projects/[id]` for `/projects/abc123`: segments holding
 * a param value are replaced by the param's name. Not-found pages have no params, so their path
 * is sent as typed (ADR-0020).
 */
function routePattern(pathname: string, params: Record<string, string | string[] | undefined>) {
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
