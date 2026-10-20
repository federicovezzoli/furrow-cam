import { Operation, PostProcessorId } from "@furrow/document";
import { z } from "zod";

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

const OPERATION_TYPES = Operation.options.map((option) => option.shape.type.value) as [
  Operation["type"],
  ...Operation["type"][],
];

/** What happened, never names, sizes or contents of the user's work. */
const TelemetryEvent = z.discriminatedUnion("event", [
  z.strictObject({ event: z.literal("project_created") }),
  z.strictObject({ event: z.literal("file_imported"), format: z.enum(["svg", "dxf", "stl"]) }),
  z.strictObject({
    event: z.literal("operation_added"),
    type: z.enum(OPERATION_TYPES),
  }),
  z.strictObject({ event: z.literal("gcode_exported"), postProcessor: PostProcessorId }),
  z.strictObject({ event: z.literal("signed_up") }),
  z.strictObject({ event: z.literal("guest_imported"), projects: z.number().int().positive() }),
]);
export type TelemetryEvent = z.infer<typeof TelemetryEvent>;

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
/**
 * `data` if it is a known event with exactly its own fields and values, else
 * `null`: the desktop main process checks what the renderer hands it.
 */
export function parseTelemetryEvent(data: unknown): TelemetryEvent | null {
  const parsed = TelemetryEvent.safeParse(data);
  return parsed.success ? parsed.data : null;
}

/**
 * `error` as it may be reported: its type, its message cut short with file
 * paths replaced, and its stack with paths reduced to the app's own files
 * (no user folder). URLs keep only their origin, or their path for the
 * site's own bundles, so no page path with a record ID is reported.
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

/**
 * Absolute file paths: a drive (not the `s:/` of `https://`) or `/` followed
 * by a user, temp or volume folder.
 */
const PATH =
  /(?:file:\/\/)?(?:(?<![A-Za-z])[A-Za-z]:[\\/]|(?<!\w)\/(?:Users|home|root|private|var|tmp|Volumes|mnt|media|opt)\/)[^'"`\n)]*/g;
const URL_IN_TEXT = /https?:\/\/[^\s'"`)]+/g;

/** A URL's origin, or origin and path for the site's bundles (`/_next/…`), which hold no IDs. */
function scrubUrl(url: string) {
  try {
    const { origin, pathname } = new URL(url);
    return pathname.startsWith("/_next/") ? `${origin}${pathname}` : origin;
  } catch {
    return "<url>";
  }
}

function scrubMessage(message: string) {
  const scrubbed = message.replace(URL_IN_TEXT, scrubUrl).replace(PATH, "<path>");
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

/** A frame's file: web URLs as `scrubUrl`, paths keep only what's inside the app. */
function scrubLocation(location: string) {
  if (/^https?:/.test(location)) return scrubUrl(location);
  // The desktop app's own files, and blobs of random IDs.
  if (/^(app|blob):/.test(location)) return location.replace(/[?#].*$/, "");
  if (/^node:|^native$|^<anonymous>$/.test(location)) return location;
  const path = location.replace(/^file:\/\//, "").replaceAll("\\", "/");
  const inside = /\/((?:out|node_modules|src)\/.*)$/.exec(path);
  return inside?.[1] ?? path.slice(path.lastIndexOf("/") + 1);
}
