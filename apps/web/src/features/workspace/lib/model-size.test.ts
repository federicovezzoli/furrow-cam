import type { Model } from "@furrow/document";
import { describe, expect, it } from "vitest";
import { originalSizeLabel } from "./model-size";

function model(placement: Partial<Model["placement"]>): Pick<Model, "bounds" | "placement"> {
  return {
    bounds: { min: [-60, 0, -5], max: [60, 80, 10] },
    placement: { rotation: [0, 0, 0], scale: 1, depth: 15, position: [0, 0], ...placement },
  };
}

describe("originalSizeLabel", () => {
  it("shows the size in the file and the scale", () => {
    expect(originalSizeLabel(model({ scale: 0.42 }), "mm")).toBe(
      "Original: 120 × 80 × 15 mm (scale 42%)",
    );
  });

  it("turns the size with the model, unscaled", () => {
    // A quarter turn about X swaps the height and the depth.
    expect(originalSizeLabel(model({ rotation: [90, 0, 0], scale: 2.5 }), "mm")).toBe(
      "Original: 120 × 15 × 80 mm (scale 250%)",
    );
    expect(originalSizeLabel(model({ rotation: [0, 0, 90], scale: 0.3333 }), "mm")).toBe(
      "Original: 80 × 120 × 15 mm (scale 33.3%)",
    );
  });

  it("shows a flat axis as 0", () => {
    const flat: Pick<Model, "bounds" | "placement"> = {
      ...model({}),
      bounds: { min: [0, 0, 0], max: [50.8, 25.4, 0] },
    };
    expect(originalSizeLabel(flat, "in")).toBe("Original: 2 × 1 × 0 in (scale 100%)");
  });
});
