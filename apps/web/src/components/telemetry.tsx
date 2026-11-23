"use client";

import { captureUncaughtErrors, setTelemetrySink } from "@furrow/workspace/lib/telemetry";
import { useParams, usePathname } from "next/navigation";
// Never loads scripts from PostHog's servers (ADR-0052).
import posthog from "posthog-js/no-external";
import { useEffect, useState } from "react";
import {
  externalOrigin,
  maskReplayAttribute,
  type PageContext,
  routePattern,
  scrubElements,
  scrubProperties,
  sentWithoutConsent,
} from "@/lib/telemetry";
import { UsageConsent } from "./usage-consent";

let page: PageContext | null = null;

/**
 * Usage and error tracking with PostHog (ADR-0052, ADR-0093). Until the visitor
 * agrees, it is cookieless and anonymous: page views, the workspace's events and
 * errors. With consent, PostHog keeps an anonymous ID in the browser and adds
 * autocapture and session replay, with every text masked. Every event carries
 * the route pattern instead of the URL, and nothing is linked to an account.
 */
export function Telemetry({ apiKey, host }: { apiKey: string; host: string }) {
  const pathname = usePathname();
  const params = useParams();
  // The prompt reads the stored answer, which needs PostHog started first.
  const [started, setStarted] = useState(false);

  // Runs after the page's own effects, so errors it hit while loading wait in the shared queue:
  // the first page view sets `page` before the sink sends them, or `before_send` would drop them.
  // biome-ignore lint/correctness/useExhaustiveDependencies: later navigations are the effect below
  useEffect(() => {
    posthog.init(apiKey, {
      api_host: host,
      // Links into PostHog's app point at the cloud, not the proxy.
      ui_host: "https://eu.posthog.com",
      // Cookieless until the visitor agrees; not having answered counts as declining.
      cookieless_mode: "on_reject",
      opt_out_capturing_by_default: true,
      person_profiles: "never",
      // Dropped by `before_send` without consent.
      autocapture: true,
      mask_all_text: true,
      capture_dead_clicks: false,
      enable_heatmaps: false,
      capture_pageview: false,
      capture_pageleave: false,
      capture_performance: false,
      // Errors go through `captureError`, which scrubs them.
      capture_exceptions: false,
      // Recording starts only with consent; the 3D viewport's canvas is never recorded.
      session_recording: {
        maskAllInputs: true,
        maskTextSelector: "*",
        maskAttributeFn: maskReplayAttribute,
      },
      enable_recording_console_log: false,
      disable_surveys: true,
      disable_product_tours: true,
      disable_conversations: true,
      // Remote config switches replay on; feature flags stay off.
      advanced_disable_feature_flags: true,
      save_referrer: false,
      save_campaign_params: false,
      before_send: (event) => {
        if (!event || !page) return null;
        const consented = posthog.get_explicit_consent_status() === "granted";
        if (!consented && !sentWithoutConsent(event.event)) return null;
        const properties = scrubProperties(event.event, event.properties, page, location.pathname);
        return {
          ...event,
          properties: scrubElements(properties),
          $set: undefined,
          $set_once: undefined,
        };
      },
    });
    visit(pathname, params);
    setTelemetrySink({
      track: ({ event, ...properties }) => posthog.capture(event, properties),
      error: (error) => posthog.captureException(error),
    });
    const stop = captureUncaughtErrors(window);
    if (posthog.get_explicit_consent_status() === "granted") startRecording();
    setStarted(true);
    return () => {
      stop();
      setTelemetrySink(null);
    };
  }, [apiKey, host]);

  // Keyed on the concrete pathname: moving between two projects is a navigation too.
  // biome-ignore lint/correctness/useExhaustiveDependencies: params change together with pathname
  useEffect(() => visit(pathname, params), [pathname]);

  return started ? <UsageConsent onChange={choose} /> : null;
}

/** Applies the visitor's answer: consent turns on the ID, autocapture and replay. */
function choose(agreed: boolean) {
  if (agreed) {
    posthog.opt_in_capturing();
    startRecording();
  } else {
    posthog.opt_out_capturing();
  }
}

/**
 * Loads the recorder from our own bundle, only once the visitor agreed, and
 * starts it when PostHog's remote config has session replay on.
 */
function startRecording() {
  import("posthog-js/dist/posthog-recorder")
    .then(() => posthog.sessionRecording?.startIfEnabledOrStop())
    .catch(() => {
      // Telemetry never breaks what the user is doing.
    });
}

/** Counts a page view, once per pathname: the first one is counted when PostHog starts. */
function visit(pathname: string, params: Record<string, string | string[] | undefined>) {
  if (page?.pathname === pathname) return;
  page = {
    origin: location.origin,
    pathname,
    pattern: routePattern(pathname, params),
    referrer: page ? null : externalOrigin(document.referrer, location.origin),
  };
  posthog.capture("$pageview");
}
