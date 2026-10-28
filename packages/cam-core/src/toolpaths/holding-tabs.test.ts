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

  it("reach from the model's outline out to the stock's edge", () => {
    const tabs = {
      width: 6,
      positions: [
        [30, 12],
        [45, 26],
      ] as [number, number][],
    };
    expect(holdingTabStrips(STOCK, [BLOCK], tabs)).toEqual([
      { modelId: BLOCK.id, at: [30, 20], to: [30, 0] },
      { modelId: BLOCK.id, at: [40, 26], to: [60, 26] },
    ]);
    expect(holdingTabStrips(STOCK, [], tabs)).toEqual([]);
  });

  it("stop where they would reach another model", () => {
    // 5 × 5 at x 50, its box grown by half the tab's width from x 47.
    const other: Model = {
      ...BLOCK,
      id: "00000000-0000-4000-8000-000000000002",
      bounds: { min: [0, 0, 0], max: [5, 5, 18] },
      placement: { ...BLOCK.placement, position: [50, 24] },
    };
    const tabs = {
      width: 6,
      positions: [
        [45, 26],
        [30, 12],
      ] as [number, number][],
    };
    expect(holdingTabStrips(STOCK, [BLOCK, other], tabs)).toEqual([
      { modelId: BLOCK.id, at: [40, 26], to: [47, 26] },
      { modelId: BLOCK.id, at: [30, 20], to: [30, 0] },
    ]);
  });
});
