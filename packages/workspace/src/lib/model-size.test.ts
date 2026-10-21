import type { Model } from "@furrow/document";
import { describe, expect, it } from "vitest";
import { cappedBorder, originalSize } from "./model-size";

function model(placement: Partial<Model["placement"]>): Pick<Model, "bounds" | "placement"> {
  return {
    bounds: { min: [-60, 0, -5], max: [60, 80, 10] },
    placement: { rotation: [0, 0, 0], scale: 1, depth: 15, position: [0, 0], ...placement },
  };
}

describe("originalSize", () => {
  it("gives the size in the file and the scale", () => {
    expect(originalSize(model({ scale: 0.42 }), "mm")).toEqual({
      size: "120 × 80 × 15 mm",
      scale: 42,
    });
  });

  it("turns the size with the model, unscaled", () => {
    // A quarter turn about X swaps the height and the depth.
    expect(originalSize(model({ rotation: [90, 0, 0], scale: 2.5 }), "mm")).toEqual({
      size: "120 × 15 × 80 mm",
      scale: 250,
    });
    expect(originalSize(model({ rotation: [0, 0, 90], scale: 0.3333 }), "mm")).toEqual({
      size: "80 × 120 × 15 mm",
      scale: 33.3,
    });
  });

  it("shows a flat axis as 0", () => {
    const flat: Pick<Model, "bounds" | "placement"> = {
      ...model({}),
      bounds: { min: [0, 0, 0], max: [50.8, 25.4, 0] },
    };
    expect(originalSize(flat, "in").size).toBe("2 × 1 × 0 in");
  });
});

describe("cappedBorder", () => {
  it("is what the cap leaves, or null without one", () => {
    const stock = { width: 200, height: 300 };
    expect(cappedBorder(10, stock, "mm")).toBeNull();
    expect(cappedBorder(60, stock, "mm")).toBe("50 mm");
    expect(cappedBorder(60, stock, "in")).toBe("1.9685 in");
  });
});
