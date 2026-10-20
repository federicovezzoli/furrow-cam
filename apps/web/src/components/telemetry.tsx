"use client";

import { captureUncaughtErrors, setTelemetrySink } from "@furrow/workspace/lib/telemetry";
import { useParams, usePathname } from "next/navigation";
// Never loads scripts from PostHog's servers (ADR-0052).
import posthog from "posthog-js/no-external";
import { useEffect } from "react";
import { externalOrigin, type PageContext, routePattern, scrubProperties } from "@/lib/telemetry";

let page: PageContext | null = null;

/**
 * Anonymous usage and error tracking with PostHog (ADR-0052): cookieless, no
 * autocapture, and every event carries the route pattern instead of the URL.
 * Every navigation, the first one included, is a page view; the workspace's
 * events and the page's uncaught errors go to PostHog too.
 */
export function Telemetry({ apiKey, host }: { apiKey: string; host: string }) {
  const pathname = usePathname();
  const params = useParams();

  useEffect(() => {
    posthog.init(apiKey, {
      api_host: host,
      // Links into PostHog's app point at the cloud, not the proxy.
      ui_host: "https://eu.posthog.com",
      cookieless_mode: "always",
      person_profiles: "never",
      autocapture: false,
      rageclick: false,
      capture_pageview: false,
      capture_pageleave: false,
      capture_performance: false,
      disable_session_recording: true,
      disable_surveys: true,
      advanced_disable_flags: true,
      save_referrer: false,
      before_send: (event) =>
        event && page
          ? {
              ...event,
              properties: scrubProperties(event.event, event.properties, page, location.pathname),
              $set: undefined,
              $set_once: undefined,
            }
          : null,
    });
    setTelemetrySink({
      track: ({ event, ...properties }) => posthog.capture(event, properties),
      error: (error) => posthog.captureException(error),
    });
    const stop = captureUncaughtErrors(window);
    return () => {
      stop();
      setTelemetrySink(null);
    };
  }, [apiKey, host]);

  // Keyed on the concrete pathname: moving between two projects is a navigation too.
  // biome-ignore lint/correctness/useExhaustiveDependencies: params change together with pathname
  useEffect(() => {
    page = {
      origin: location.origin,
      pathname,
      pattern: routePattern(pathname, params),
      referrer: page ? null : externalOrigin(document.referrer, location.origin),
    };
    posthog.capture("$pageview");
  }, [pathname]);

  return null;
}
