import { describe, expect, it } from "vitest";
import { fromMillimetres, toMillimetres } from "./units";

describe("units", () => {
  it("converts inches to millimetres", () => {
    expect(toMillimetres(0.25, "in")).toBeCloseTo(6.35);
  });

  it("leaves millimetres unchanged", () => {
    expect(toMillimetres(6, "mm")).toBe(6);
  });

  it("round-trips", () => {
    expect(fromMillimetres(toMillimetres(1.5, "in"), "in")).toBeCloseTo(1.5);
  });
});
