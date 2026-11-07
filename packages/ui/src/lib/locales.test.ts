import { describe, expect, it } from "vitest";
import { delocalizeDecimal, localizeDecimal } from "./locales";

describe("localizeDecimal", () => {
  it("writes decimals as the language does", () => {
    expect(localizeDecimal("3.5 × 2", "it")).toBe("3,5 × 2");
    expect(localizeDecimal("3.5", "en")).toBe("3.5");
  });
});

describe("delocalizeDecimal", () => {
  it("reads a comma as a decimal point only where the language writes one", () => {
    expect(delocalizeDecimal("1,5 + 2,25", "de")).toBe("1.5 + 2.25");
    // An English thousands separator stays, so parsing rejects it instead of reading 1.5.
    expect(delocalizeDecimal("1,500", "en")).toBe("1,500");
    for (const locale of ["es", "nl", "pt", "el", "tr"]) {
      expect(delocalizeDecimal("1,5", locale)).toBe("1.5");
    }
    expect(delocalizeDecimal("1.5", "ja")).toBe("1.5");
  });
});
