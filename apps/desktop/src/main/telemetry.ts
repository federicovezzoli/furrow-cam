/**
 * Whether the user agreed to send usage statistics and error reports
 * (ADR-0052), and the anonymous ID that counts returning use (ADR-0093). Pure
 * helpers: the client, the dialog and the menu are in `index.ts`.
 */

/**
 * What the user chose, kept in `telemetry.json`; `enabled` is `undefined`
 * until asked, and `id` is kept only while it is `true`.
 */
export type TelemetryPrefs = { enabled?: boolean; id?: string };

const ID = /^[0-9a-f-]{36}$/;

export function parseTelemetryPrefs(data: unknown): TelemetryPrefs {
  if (typeof data !== "object" || data === null) return {};
  const { enabled, id } = data as Record<string, unknown>;
  if (typeof enabled !== "boolean") return {};
  return enabled && typeof id === "string" && ID.test(id) ? { enabled, id } : { enabled };
}

/** The prefs after the user's answer: agreeing keeps or makes an ID, declining forgets it. */
export function chooseTelemetry(
  prefs: TelemetryPrefs,
  enabled: boolean,
  newId: () => string,
): TelemetryPrefs {
  return enabled ? { enabled, id: prefs.id ?? newId() } : { enabled };
}
