"use client";

import { posthogHost } from "@furrow/workspace/lib/telemetry";
import { ErrorFallback } from "@/components/error-fallback";
import { Telemetry } from "@/components/telemetry";
import "./globals.css";

/** Replaces the root layout when it fails, and reports the error (ADR-0052). */
export default function GlobalError(props: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <title>Something went wrong · Furrow CAM</title>
        <ErrorFallback {...props} message="Furrow CAM couldn't be loaded. Try again in a moment." />
        {/* The root layout and its telemetry are gone, or never loaded: start it here. */}
        {process.env.NEXT_PUBLIC_POSTHOG_KEY && (
          <Telemetry
            apiKey={process.env.NEXT_PUBLIC_POSTHOG_KEY}
            host={posthogHost(process.env.NEXT_PUBLIC_POSTHOG_HOST)}
          />
        )}
      </body>
    </html>
  );
}
