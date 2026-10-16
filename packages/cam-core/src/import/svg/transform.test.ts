import { describe, expect, it } from "vitest";
import { apply, isSimilarity, type Matrix, parseTransform } from "./transform";

function expectPoint(actual: [number, number], expected: [number, number]) {
  expect(actual[0]).toBeCloseTo(expected[0], 9);
  expect(actual[1]).toBeCloseTo(expected[1], 9);
}

describe("parseTransform", () => {
  it("applies a list right to left, as nested transforms", () => {
    const m = parseTransform("translate(10, 20) scale(2)") as Matrix;
    expectPoint(apply(m, [1, 1]), [12, 22]);
  });

  it.each([
    ["matrix(1 0 0 1 5 -5)", [6, -4]],
    ["translate(5)", [6, 1]],
    ["scale(2,3)", [2, 3]],
    ["rotate(90)", [-1, 1]],
    ["rotate(90 1 0)", [0, 0]],
    ["skewX(45)", [2, 1]],
    ["skewY(45)", [1, 2]],
    ["", [1, 1]],
    ["translate(1e1,-.5e1)", [11, -4]],
  ] as const)("parses %s", (text, expected) => {
    expectPoint(apply(parseTransform(text) as Matrix, [1, 1]), [...expected]);
  });

  it.each(["translate(1) bogus", "matrix(1 0 0 1)", "rotate"])("rejects %s", (text) => {
    expect(parseTransform(text)).toBeNull();
  });
});

describe("isSimilarity", () => {
  it("accepts rotations, uniform scales and mirrors, not stretches or skews", () => {
    expect(isSimilarity(parseTransform("rotate(30) scale(2) translate(4 5)") as Matrix)).toBe(true);
    expect(isSimilarity(parseTransform("scale(1 -1)") as Matrix)).toBe(true);
    expect(isSimilarity(parseTransform("scale(1 2)") as Matrix)).toBe(false);
    expect(isSimilarity(parseTransform("skewX(10)") as Matrix)).toBe(false);
  });
});
