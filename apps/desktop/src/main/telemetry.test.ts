import { describe, expect, it } from "vitest";
import { parseTelemetryPrefs } from "./telemetry";

describe("parseTelemetryPrefs", () => {
  it("keeps the user's answer", () => {
    expect(parseTelemetryPrefs({ enabled: true })).toEqual({ enabled: true });
    expect(parseTelemetryPrefs({ enabled: false })).toEqual({ enabled: false });
  });

  it("asks again for anything else", () => {
    expect(parseTelemetryPrefs(null)).toEqual({});
    expect(parseTelemetryPrefs({ enabled: "yes" })).toEqual({});
  });
});
