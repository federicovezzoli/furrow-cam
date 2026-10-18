"use client";

import { useIsClient } from "@furrow/ui/hooks/use-is-client";
import type * as React from "react";
import { Suspense } from "react";

/**
 * Renders `children` in the browser only, `fallback` on the server and while
 * a lazy child loads: for components that need WebGL (ADR-0008), loaded with
 * `React.lazy` so they stay out of the page's first bundle.
 */
export function BrowserOnly({
  fallback,
  children,
}: {
  fallback: React.ReactNode;
  children: React.ReactNode;
}) {
  return useIsClient() ? <Suspense fallback={fallback}>{children}</Suspense> : fallback;
}
