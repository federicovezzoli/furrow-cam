"use client";

import { useParams, usePathname } from "next/navigation";
import Script from "next/script";
import { useEffect, useState } from "react";
import { routePattern } from "@/lib/route-pattern";

declare global {
  interface Window {
    goatcounter?: { count: (vars: { path: string; title: string }) => void };
  }
}

/**
 * Page-view counting with GoatCounter (ADR-0020). `no_onload` turns off count.js's own count
 * on load, so every page view, the first one included, is counted here exactly once. Only the
 * route pattern is sent, never IDs, query strings or hashes; the title is the pattern too, so
 * a page title never leaks data.
 */
export function PageViewAnalytics({ endpoint }: { endpoint: string }) {
  const pathname = usePathname();
  const params = useParams();
  const [ready, setReady] = useState(false);

  // Keyed on the concrete pathname: moving between two projects is a navigation too.
  // biome-ignore lint/correctness/useExhaustiveDependencies: params change together with pathname
  useEffect(() => {
    if (!ready) return;
    const path = routePattern(pathname, params);
    window.goatcounter?.count({ path, title: path });
  }, [ready, pathname]);

  return (
    <Script
      src="https://gc.zgo.at/count.js"
      strategy="afterInteractive"
      data-goatcounter={endpoint}
      data-goatcounter-settings={JSON.stringify({ no_onload: true })}
      onReady={() => setReady(true)}
    />
  );
}
