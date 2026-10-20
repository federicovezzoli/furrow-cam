import { afterEach, describe, expect, it, vi } from "vitest";
import {
  captureError,
  POSTHOG_HOST,
  parseTelemetryEvent,
  posthogHost,
  reportableError,
  setTelemetrySink,
  track,
} from "./telemetry";

describe("reportableError", () => {
  it("keeps the type, cuts the message and replaces file paths", () => {
    const error = new TypeError(
      `ENOENT: no such file or directory, open '/Users/ada/Documents/Coasters.furrow' ${"x".repeat(300)}`,
    );
    const report = reportableError(error);
    expect(report.name).toBe("TypeError");
    expect(report.message).toMatch(/^ENOENT: no such file or directory, open '<path>' x+…$/);
    expect(report.message).not.toContain("ada");
    expect(report.message.length).toBeLessThanOrEqual(201);
  });

  it("reduces stack paths to the app's files and drops query strings", () => {
    const error = new Error("boom");
    error.stack = [
      "Error: boom",
      "    at open (/Users/ada/Applications/Furrow CAM.app/Contents/Resources/app.asar/out/main/index.cjs:12:3)",
      "    at C:\\Users\\ada\\AppData\\Local\\Programs\\furrow\\resources\\app.asar\\out\\main\\index.cjs:4:5",
      "    at render (https://furrow.cam/reset-password?token=secret:1:2)",
      "    at app://furrow/assets/index-abc.js:7:8",
      "    at node:internal/process/task_queues:105:5",
      "submit@https://furrow.cam/_next/static/chunks/page.js?v=1:3:4",
    ].join("\n");
    expect(reportableError(error).stack).toBe(
      [
        "Error: boom",
        "    at open (out/main/index.cjs:12:3)",
        "    at out/main/index.cjs:4:5",
        "    at render (https://furrow.cam:1:2)",
        "    at app://furrow/assets/index-abc.js:7:8",
        "    at node:internal/process/task_queues:105:5",
        "submit@https://furrow.cam/_next/static/chunks/page.js:3:4",
      ].join("\n"),
    );
  });

  it("keeps a URL's origin, never its page path, and doesn't take it for a drive", () => {
    const error = new Error(
      "Failed to fetch https://furrow.cam/projects/abc123?x=1 from C:\\Users\\ada",
    );
    expect(reportableError(error).message).toBe("Failed to fetch https://furrow.cam from <path>");
    expect(reportableError(new Error("at file:///Users/ada/x.svg")).message).toBe("at <path>");
  });

  it("reports thrown values that aren't errors", () => {
    expect(reportableError("plain").message).toBe("plain");
    expect(reportableError({ message: "shaped", name: "AbortError" }).name).toBe("AbortError");
  });
});

describe("parseTelemetryEvent", () => {
  it("accepts known events with their own fields", () => {
    expect(parseTelemetryEvent({ event: "file_imported", format: "svg" })).toEqual({
      event: "file_imported",
      format: "svg",
    });
    expect(parseTelemetryEvent({ event: "project_created" })).toEqual({ event: "project_created" });
  });

  it("refuses unknown events, extra or missing fields and unknown values", () => {
    expect(parseTelemetryEvent({ event: "toString" })).toBeNull();
    expect(parseTelemetryEvent({ event: "project_created", name: "Coasters" })).toBeNull();
    expect(parseTelemetryEvent({ event: "file_imported" })).toBeNull();
    expect(parseTelemetryEvent({ event: "file_imported", format: "Coasters.svg" })).toBeNull();
    expect(parseTelemetryEvent({ event: "operation_added", type: "pocket" })).not.toBeNull();
    expect(parseTelemetryEvent({ event: "operation_added", type: "teleport" })).toBeNull();
    expect(parseTelemetryEvent({ event: "guest_imported", projects: Number.NaN })).toBeNull();
    expect(parseTelemetryEvent(null)).toBeNull();
  });
});

describe("posthogHost", () => {
  it("uses the proxy domain when set, else the EU cloud", () => {
    expect(posthogHost("https://e.furrow.cam/")).toBe("https://e.furrow.cam");
    expect(posthogHost("")).toBe(POSTHOG_HOST);
    expect(posthogHost(undefined)).toBe(POSTHOG_HOST);
  });
});

describe("the sink", () => {
  afterEach(() => setTelemetrySink(null));

  it("goes nowhere until an app sets it, and never throws", () => {
    expect(() => track({ event: "signed_up" })).not.toThrow();
    setTelemetrySink({
      track: () => {
        throw new Error("offline");
      },
      error: () => {},
    });
    expect(() => track({ event: "signed_up" })).not.toThrow();
  });

  it("sends what came before the sink, and each error once", () => {
    captureError(new Error("failed while loading"));
    track({ event: "project_created" });
    const sink = { track: vi.fn(), error: vi.fn() };
    setTelemetrySink(sink);
    expect(sink.track).toHaveBeenCalledWith({ event: "project_created" });
    expect(sink.error).toHaveBeenCalledTimes(1);
    for (let frame = 0; frame < 60; frame++) captureError(new Error("useFrame failed"));
    expect(sink.error).toHaveBeenCalledTimes(2);
  });

  it("hands errors on already scrubbed", () => {
    const error = vi.fn();
    setTelemetrySink({ track: () => {}, error });
    captureError(new Error("at /home/ada/file.svg"));
    expect(error.mock.calls[0]?.[0].message).toBe("at <path>");
  });
});
