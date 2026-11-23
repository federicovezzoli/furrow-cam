import { describe, expect, it } from "vitest";
import { chooseTelemetry, parseTelemetryPrefs } from "./telemetry";

const ID = "0b0c8a8e-6f1e-4c55-9d5b-6c2f1d7f3a10";

describe("parseTelemetryPrefs", () => {
  it("keeps the user's answer", () => {
    expect(parseTelemetryPrefs({ enabled: true })).toEqual({ enabled: true });
    expect(parseTelemetryPrefs({ enabled: false })).toEqual({ enabled: false });
  });

  it("keeps the anonymous ID only while the user agrees", () => {
    expect(parseTelemetryPrefs({ enabled: true, id: ID })).toEqual({ enabled: true, id: ID });
    expect(parseTelemetryPrefs({ enabled: false, id: ID })).toEqual({ enabled: false });
    expect(parseTelemetryPrefs({ enabled: true, id: "me@example.com" })).toEqual({
      enabled: true,
    });
  });

  it("asks again for anything else", () => {
    expect(parseTelemetryPrefs(null)).toEqual({});
    expect(parseTelemetryPrefs({ enabled: "yes" })).toEqual({});
  });
});

describe("chooseTelemetry", () => {
  const newId = () => ID;

  it("makes an ID when the user agrees, and keeps it across answers", () => {
    expect(chooseTelemetry({}, true, newId)).toEqual({ enabled: true, id: ID });
    const other = "11111111-2222-3333-4444-555555555555";
    expect(chooseTelemetry({ enabled: true, id: other }, true, newId)).toEqual({
      enabled: true,
      id: other,
    });
  });

  it("forgets the ID when the user turns it off", () => {
    expect(chooseTelemetry({ enabled: true, id: ID }, false, newId)).toEqual({ enabled: false });
  });
});
