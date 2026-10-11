import { describe, expect, it } from "vitest";
import { pointLabel, snapLabel } from "./snap-label";

describe("snapLabel", () => {
  it("names the snap target's kind", () => {
    expect(snapLabel({ kind: "stock_anchor", anchor: "top_left", point: [0, 400] })).toBe(
      "Stock top left",
    );
    expect(snapLabel({ kind: "circle_center", point: [1, 2] })).toBe("Circle centre");
    expect(snapLabel({ kind: "bounds_corner", point: [1, 2] })).toBe("Bounding box corner");
    expect(snapLabel(null)).toBe("Point");
  });
});

describe("pointLabel", () => {
  it("shows the coordinates in the project's units", () => {
    expect(pointLabel([12.5, -3], "mm")).toBe("X 12.5 mm, Y -3 mm");
    expect(pointLabel([25.4, 50.8], "in")).toBe("X 1 in, Y 2 in");
  });
});
