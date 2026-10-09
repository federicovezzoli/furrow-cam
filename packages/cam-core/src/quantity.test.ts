import { describe, expect, it } from "vitest";
import { formatQuantity, parseQuantity, unitLabel } from "./quantity";

/** The parsed value, failing the test on a parse error. */
function value(
  text: string,
  units: "mm" | "in" = "mm",
  quantity: "length" | "feed" | "number" = "length",
) {
  const result = parseQuantity(text, quantity, units);
  if (!result.ok) throw new Error(`${text}: ${result.error}`);
  return result.value;
}

function error(
  text: string,
  units: "mm" | "in" = "mm",
  quantity: "length" | "feed" | "number" = "length",
) {
  const result = parseQuantity(text, quantity, units);
  if (result.ok) throw new Error(`${text} parsed as ${result.value}`);
  return result.error;
}

describe("parseQuantity", () => {
  it("reads plain numbers in the display units", () => {
    expect(value("6.35")).toBe(6.35);
    expect(value(".5")).toBe(0.5);
    expect(value("3.")).toBe(3);
    expect(value("0.25", "in")).toBeCloseTo(6.35);
  });

  it("converts an explicit unit to millimetres, whatever the display units", () => {
    expect(value("6.35mm", "in")).toBe(6.35);
    expect(value("1/4in")).toBeCloseTo(6.35);
    expect(value('1/4"')).toBeCloseTo(6.35);
    expect(value("1/4 IN")).toBeCloseTo(6.35);
    expect(value("2cm")).toBe(20);
    expect(value("1.2m")).toBe(1200);
    expect(value("1ft")).toBeCloseTo(304.8);
  });

  it("evaluates expressions", () => {
    expect(value("10/2")).toBe(5);
    expect(value("2 + 3 * 4")).toBe(14);
    expect(value("(2 + 3) * 4")).toBe(20);
    expect(value("10 - 2 - 3")).toBe(5);
    expect(value("-(1 + 2)")).toBe(-3);
    expect(value("18 - 2 * -1.5")).toBe(21);
    expect(value("(3/4 + 1/8) in")).toBeCloseTo(22.225);
  });

  it("reads feed rates per minute", () => {
    expect(value("600", "mm", "feed")).toBe(600);
    expect(value("100", "in", "feed")).toBeCloseTo(2540);
    expect(value("100 in/min", "mm", "feed")).toBeCloseTo(2540);
    expect(value("100ipm", "mm", "feed")).toBeCloseTo(2540);
    expect(value("10mm/s", "in", "feed")).toBe(600);
  });

  it("leaves plain numbers alone in either units", () => {
    expect(value("24000", "in", "number")).toBe(24000);
    expect(value("100/3", "in", "number")).toBeCloseTo(33.333);
  });

  it("rejects what isn't a number", () => {
    expect(error("")).toBe("Enter a number");
    expect(error("  ")).toBe("Enter a number");
    expect(error("mm")).toBe("Enter a number");
    expect(error("abc")).toBe('Unknown unit "abc"');
    expect(error("10min")).toBe('Unknown unit "min"');
    expect(error("10mm", "mm", "number")).toBe('Unknown unit "mm"');
    expect(error("10in/min")).toBe('Unknown unit "in"');
    expect(error("1 +")).toBe("Not a number or expression");
    expect(error("(1 + 2")).toBe("Not a number or expression");
    expect(error("1 2")).toBe("Not a number or expression");
    expect(error("1,5")).toBe("Not a number or expression");
    expect(error("1.2.3")).toBe("Not a number or expression");
  });

  it("rejects results that aren't finite", () => {
    expect(error("1/0")).toBe("The result isn't a finite number");
    expect(error("0/0")).toBe("The result isn't a finite number");
  });
});

describe("formatQuantity", () => {
  it("writes lengths in the display units", () => {
    expect(formatQuantity(6.35, "length", "mm")).toBe("6.35");
    expect(formatQuantity(6.35, "length", "in")).toBe("0.25");
    expect(formatQuantity(1 / 3, "length", "mm")).toBe("0.333");
    expect(formatQuantity(1, "length", "in")).toBe("0.0394");
    expect(formatQuantity(2540, "feed", "in")).toBe("100");
    expect(formatQuantity(24000, "number", "in")).toBe("24000");
  });

  it("rounds limits so they stay within themselves", () => {
    expect(formatQuantity(0.1, "length", "in")).toBe("0.0039");
    expect(formatQuantity(0.1, "length", "in", "up")).toBe("0.004");
    expect(value(formatQuantity(0.1, "length", "in", "up"), "in")).toBeGreaterThanOrEqual(0.1);
    expect(formatQuantity(1000, "length", "in", "down")).toBe("39.37");
    expect(value(formatQuantity(1000, "length", "in", "down"), "in")).toBeLessThanOrEqual(1000);
    // Exact values aren't pushed to the next decimal by floating-point noise.
    expect(formatQuantity(6.35, "length", "in", "up")).toBe("0.25");
    expect(formatQuantity(6.35, "length", "in", "down")).toBe("0.25");
  });

  it("round-trips through parseQuantity", () => {
    for (const mm of [6.35, 18, 600, 0.1]) {
      expect(value(formatQuantity(mm, "length", "in"), "in")).toBeCloseTo(mm, 2);
    }
  });
});

describe("unitLabel", () => {
  it("names the display unit", () => {
    expect(unitLabel("length", "in")).toBe("in");
    expect(unitLabel("feed", "mm")).toBe("mm/min");
    expect(unitLabel("number", "mm")).toBe("");
  });
});
