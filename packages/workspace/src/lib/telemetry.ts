import type { Operation, PostProcessorId } from "@furrow/document";

/**
 * Anonymous usage events and error reports (ADR-0052). The workspace and the
 * apps call `track` and `captureError`; each app sets where they go (PostHog
 * on the web, the main process on desktop), and without that they go nowhere.
 * Plain module: the desktop main process imports it too.
 */

/** PostHog's EU cloud: where both apps send unless a build names our proxy domain. */
export const POSTHOG_HOST = "https://eu.i.posthog.com";

/** The configured host without a trailing slash, or the EU cloud when unset. */
export function posthogHost(configured: string | undefined): string {
  return configured?.trim().replace(/\/+$/, "") || POSTHOG_HOST;
}

/** What happened, never names, sizes or contents of the user's work. */
export type TelemetryEvent =
  | { event: "project_created" }
  | { event: "file_imported"; format: "svg" | "dxf" | "stl" }
  | { event: "operation_added"; type: Operation["type"] }
  | { event: "gcode_exported"; postProcessor: PostProcessorId }
  | { event: "signed_up" }
  | { event: "guest_imported"; projects: number };

export type TelemetrySink = {
  track(event: TelemetryEvent): void;
  /** An error already made reportable by `reportableError`. */
  error(error: Error): void;
};

let sink: TelemetrySink | null = null;
/** Calls made before an app set its sink, e.g. by a page that failed while loading. */
let pending: ((sink: TelemetrySink) => void)[] = [];
const MAX_PENDING = 20;
/** Errors sent this session: a render loop that keeps failing sends its error once. */
const reported = new Set<string>();
const MAX_ERRORS = 20;

/** Sets where events and errors go, and sends those made before. */
export function setTelemetrySink(next: TelemetrySink | null) {
  sink = next;
  if (!next) return;
  const queued = pending;
  pending = [];
  for (const call of queued) send(call);
}

function send(call: (sink: TelemetrySink) => void) {
  try {
    if (sink) call(sink);
    else if (pending.length < MAX_PENDING) pending.push(call);
  } catch {
    // Telemetry never breaks what the user is doing.
  }
}

export function track(event: TelemetryEvent) {
  send((to) => to.track(event));
}

/** Reports `error` unless the same one was sent already or this session sent enough. */
export function captureError(error: unknown) {
  let report: Error;
  try {
    report = reportableError(error);
  } catch {
    return; // A thrown value that can't even be turned into a string.
  }
  const key = `${report.name}: ${report.message}\n${report.stack?.split("\n")[1] ?? ""}`;
  if (reported.has(key) || reported.size >= MAX_ERRORS) return;
  reported.add(key);
  send((to) => to.error(report));
}

/** Reports the window's uncaught errors and unhandled rejections; returns the cleanup. */
// Typed as an `EventTarget`: the desktop main process imports this module without the DOM's types.
export function captureUncaughtErrors(target: EventTarget) {
  const onError = (event: Event) => {
    const { error, message } = event as Event & { error?: unknown; message?: string };
    captureError(error ?? message);
  };
  const onRejection = (event: Event) =>
    captureError((event as Event & { reason?: unknown }).reason);
  target.addEventListener("error", onError);
  target.addEventListener("unhandledrejection", onRejection);
  return () => {
    target.removeEventListener("error", onError);
    target.removeEventListener("unhandledrejection", onRejection);
  };
}

const MESSAGE_LENGTH = 200;
const FIELDS: Record<string, readonly string[]> = {
  project_created: [],
  file_imported: ["format"],
  operation_added: ["type"],
  gcode_exported: ["postProcessor"],
  signed_up: [],
  guest_imported: ["projects"],
};

/**
 * `data` if it is a known event with only its own short fields, else `null`:
 * the desktop main process checks what the renderer hands it.
 */
export function parseTelemetryEvent(data: unknown): TelemetryEvent | null {
  if (typeof data !== "object" || data === null) return null;
  const { event, ...fields } = data as Record<string, unknown>;
  const allowed = typeof event === "string" && Object.hasOwn(FIELDS, event) ? FIELDS[event] : null;
  if (!allowed) return null;
  for (const [key, value] of Object.entries(fields)) {
    if (!allowed.includes(key)) return null;
    if (typeof value === "string" ? value.length > 40 : typeof value !== "number") return null;
  }
  return data as TelemetryEvent;
}

/**
 * `error` as it may be reported: its type, its message cut short with file
 * paths replaced, and its stack with paths reduced to the app's own files
 * (no user folder) and URLs without query strings or hashes.
 */
export function reportableError(error: unknown): Error {
  const source =
    error instanceof Error
      ? error
      : typeof error === "object" && error !== null && "message" in error
        ? (error as { name?: unknown; message?: unknown; stack?: unknown })
        : { message: String(error) };
  const report = new Error(scrubMessage(String(source.message ?? "")));
  report.name = typeof source.name === "string" ? source.name.slice(0, 60) : "Error";
  report.stack = typeof source.stack === "string" ? scrubStack(source.stack) : undefined;
  return report;
}

/** Absolute file paths: a drive or `/` followed by a user, temp or volume folder. */
const PATH =
  /(?:file:\/\/)?(?:[A-Za-z]:[\\/]|\/(?:Users|home|root|private|var|tmp|Volumes|mnt|media|opt)\/)[^'"`\n)]*/g;
const QUERY = /(https?:\/\/[^\s?#'"`)]*)[?#][^\s'"`)]*/g;

function scrubMessage(message: string) {
  const scrubbed = message.replace(PATH, "<path>").replace(QUERY, "$1");
  return scrubbed.length > MESSAGE_LENGTH ? `${scrubbed.slice(0, MESSAGE_LENGTH)}…` : scrubbed;
}

/** V8 (`at f (where:1:2)`) and Firefox/Safari (`f@where:1:2`) frames. */
const V8_FRAME = /^(\s*at (?:.*? \()?)(.+?)(:\d+:\d+\)?)$/;
const GECKO_FRAME = /^([^@\s]*@)(.+?)(:\d+:\d+)$/;

function scrubStack(stack: string) {
  return stack
    .split("\n")
    .map((line, index) => {
      if (index === 0) return scrubMessage(line);
      const frame = V8_FRAME.exec(line) ?? GECKO_FRAME.exec(line);
      return frame ? `${frame[1]}${scrubLocation(frame[2] ?? "")}${frame[3]}` : "";
    })
    .filter((line) => line !== "")
    .join("\n");
}

/** A frame's file: URLs lose their query, paths keep only what's inside the app. */
function scrubLocation(location: string) {
  if (/^(https?|app|blob):/.test(location)) return location.replace(/[?#].*$/, "");
  if (/^node:|^native$|^<anonymous>$/.test(location)) return location;
  const path = location.replace(/^file:\/\//, "").replaceAll("\\", "/");
  const inside = /\/((?:out|node_modules|src)\/.*)$/.exec(path);
  return inside?.[1] ?? path.slice(path.lastIndexOf("/") + 1);
}
