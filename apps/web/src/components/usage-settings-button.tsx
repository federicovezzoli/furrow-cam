"use client";

import { openUsageSettings } from "@/lib/telemetry";

/** Reopens the usage statistics prompt, from the site footer (ADR-0093). */
export function UsageSettingsButton({ children }: { children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={openUsageSettings}
      className="underline-offset-4 hover:text-foreground hover:underline"
    >
      {children}
    </button>
  );
}
