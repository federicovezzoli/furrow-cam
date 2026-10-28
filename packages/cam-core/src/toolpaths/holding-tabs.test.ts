import type { Model } from "@furrow/document";
import { model } from "@furrow/document/fixtures";
import { describe, expect, it } from "vitest";
import { autoHoldingTabPositions, holdingTabStrips, modelOutlines } from "./holding-tabs";

/** A 20 × 10 model with its lower-left corner at (20, 20). */
const BLOCK: Model = {
  ...model,
  bounds: { min: [0, 0, 0], max: [20, 10, 18] },
  placement: { rotation: [0, 0, 0], scale: 1, depth: 18, position: [20, 20] },
};
const STOCK = { width: 60, height: 50 };

describe("holding tabs", () => {
  it("go round each model's box", () => {
    expect(modelOutlines([BLOCK])).toEqual([
      [
        [20, 20],
        [40, 20],
        [40, 30],
        [20, 30],
        [20, 20],
      ],
    ]);
    expect(autoHoldingTabPositions([BLOCK], 4)).toEqual([
      [27.5, 20],
      [40, 22.5],
      [32.5, 30],
      [20, 27.5],
    ]);
    expect(autoHoldingTabPositions([], 4)).toEqual([]);
  });

  it("reach from the middle of the model's box out to the stock's edge", () => {
    expect(
      holdingTabStrips(STOCK, [BLOCK], {
        positions: [
          [30, 12],
          [45, 26],
        ],
      }),
    ).toEqual([
      { at: [30, 20], from: [30, 25], to: [30, 0] },
      { at: [40, 26], from: [30, 26], to: [60, 26] },
    ]);
    expect(holdingTabStrips(STOCK, [], { positions: [[30, 12]] })).toEqual([]);
  });
});
