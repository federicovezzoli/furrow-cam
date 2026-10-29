import { describe, expect, it } from "vitest";
import { formatNumber } from "./format";

describe("formatNumber", () => {
  it("rounds to 3 decimals without trailing zeros or -0", () => {
    expect(formatNumber(100)).toBe("100");
    expect(formatNumber(1.5)).toBe("1.5");
    expect(formatNumber(1 / 3)).toBe("0.333");
    expect(formatNumber(-0.0004)).toBe("0");
    expect(formatNumber(-0)).toBe("0");
    expect(formatNumber(-12.3456)).toBe("-12.346");
  });
});
