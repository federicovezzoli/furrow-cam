"use client";

import { ErrorFallback } from "@/components/error-fallback";
import "./globals.css";

/** Replaces the root layout when it fails, so the error is reported there too (ADR-0052). */
export default function GlobalError(props: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <title>Something went wrong · Furrow CAM</title>
        <ErrorFallback {...props} message="Furrow CAM couldn't be loaded. Try again in a moment." />
      </body>
    </html>
  );
}
