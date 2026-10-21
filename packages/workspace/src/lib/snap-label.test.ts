import { describe, expect, it } from "vitest";
import { pointLabel, snapKey } from "./snap-label";

describe("snapKey", () => {
  it("names the snap target's kind", () => {
    expect(snapKey({ kind: "stock_anchor", anchor: "top_left", point: [0, 400] })).toBe(
      "anchors.top_left",
    );
    expect(snapKey({ kind: "circle_center", point: [1, 2] })).toBe("circle_center");
    expect(snapKey(null)).toBe("point");
  });
});

describe("pointLabel", () => {
  it("shows the coordinates in the project's units", () => {
    expect(pointLabel([12.5, -3], "mm")).toBe("X 12.5 mm, Y -3 mm");
    expect(pointLabel([25.4, 50.8], "in")).toBe("X 1 in, Y 2 in");
  });

  it("writes decimals as the language does", () => {
    expect(pointLabel([12.5, -3], "mm", "it")).toBe("X 12,5 mm, Y -3 mm");
  });
});
