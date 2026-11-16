import type { Model } from "@furrow/document";
import { model } from "@furrow/document/fixtures";
import { describe, expect, it } from "vitest";
import { type ModelPreview, previewKey } from "../../stores/model-preview-scheduler";
import { drawnHoldingTabStrips } from "./tabs";

/** A 20 × 10 model at (20, 20) whose preview has model only in its middle four cells of 4 × 4. */
const BLOCK: Model = {
  ...model,
  bounds: { min: [0, 0, 0], max: [20, 10, 18] },
  placement: { rotation: [0, 0, 0], scale: 1, depth: 18, top: 0, position: [20, 20] },
};
const PREVIEW: ModelPreview = {
  heightmap: {
    columns: 4,
    rows: 4,
    cellWidth: 5,
    cellHeight: 2.5,
    heights: Float32Array.from({ length: 16 }, (_, i) => ([5, 6, 9, 10].includes(i) ? 0 : -19)),
  },
};
const STOCK = { width: 60, height: 50 };
const TABS = { width: 6, positions: [[30, 12]] as [number, number][] };

describe("drawnHoldingTabStrips", () => {
  it("draws a tab to the model's surface once its preview is in", () => {
    const previews = new Map([[previewKey(BLOCK), PREVIEW]]);
    expect(drawnHoldingTabStrips(STOCK, [BLOCK], TABS, previews)).toEqual([
      { modelId: BLOCK.id, at: [30, 22.5], to: [30, 0] },
    ]);
  });

  it("draws it from the box while the preview is missing, failed or for another rotation", () => {
    const fromBox = [{ modelId: BLOCK.id, at: [30, 20], to: [30, 0] }];
    expect(drawnHoldingTabStrips(STOCK, [BLOCK], TABS, new Map())).toEqual(fromBox);
    const failed = new Map([[previewKey(BLOCK), { error: { code: "x" } } as ModelPreview]]);
    expect(drawnHoldingTabStrips(STOCK, [BLOCK], TABS, failed)).toEqual(fromBox);
    const turned = { ...BLOCK.placement, rotation: [0, 0, 90] as Model["placement"]["rotation"] };
    const stale = new Map([[previewKey({ ...BLOCK, placement: turned }), PREVIEW]]);
    expect(drawnHoldingTabStrips(STOCK, [BLOCK], TABS, stale)).toEqual(fromBox);
  });
});
