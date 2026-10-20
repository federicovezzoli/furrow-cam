/**
 * Whether the user agreed to send usage statistics and error reports
 * (ADR-0052). Pure helpers: the client, the dialog and the menu are in `index.ts`.
 */

/** What the user chose, kept in `telemetry.json`; `enabled` is `undefined` until asked. */
export type TelemetryPrefs = { enabled?: boolean };

export function parseTelemetryPrefs(data: unknown): TelemetryPrefs {
  if (typeof data !== "object" || data === null) return {};
  const { enabled } = data as Record<string, unknown>;
  return typeof enabled === "boolean" ? { enabled } : {};
}

/** The PostHog key the build was made with; an empty one turns telemetry off. */
export function telemetryKey(value: string | undefined): string | null {
  return value?.trim() || null;
}
