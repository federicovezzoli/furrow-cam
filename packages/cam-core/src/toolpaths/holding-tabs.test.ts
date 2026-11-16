import type { Model } from "@furrow/document";
import { model } from "@furrow/document/fixtures";
import { describe, expect, it } from "vitest";
import {
  autoHoldingTabPositions,
  holdingTabStrips,
  modelOutlines,
  reachPreview,
} from "./holding-tabs";
import { modelHeightmap } from "./relief/mesh-raster";

/** A 20 × 10 model with its lower-left corner at (20, 20). */
const BLOCK: Model = {
  ...model,
  bounds: { min: [0, 0, 0], max: [20, 10, 18] },
  placement: { rotation: [0, 0, 0], scale: 1, depth: 18, top: 0, position: [20, 20] },
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

describe("reachPreview", () => {
  // BLOCK's preview, 4 × 4 cells of 5 × 2.5: model only in the middle four, the rest below its bottom.
  const at = (covered: boolean[]) => ({
    columns: 4,
    rows: 4,
    cellWidth: 5,
    cellHeight: 2.5,
    heights: Float32Array.from(covered, (on) => (on ? 0 : -19)),
  });
  const inset = at([...Array(16)].map((_, i) => [5, 6, 9, 10].includes(i)));

  it("carries a strip on inward to the model's surface", () => {
    const below = {
      modelId: BLOCK.id,
      at: [30, 20] as [number, number],
      to: [30, 0] as [number, number],
    };
    const right = {
      modelId: BLOCK.id,
      at: [40, 26] as [number, number],
      to: [60, 26] as [number, number],
    };
    expect(reachPreview(below, BLOCK, inset)).toEqual({ ...below, at: [30, 22.5] });
    expect(reachPreview(right, BLOCK, inset)).toEqual({ ...right, at: [35, 26] });
    // Scaled twice as large, the box is 40 × 20 and the model starts 5 in.
    const scaled = { ...BLOCK, placement: { ...BLOCK.placement, scale: 2 } };
    const centred = { ...below, at: [40, 20] as [number, number], to: [40, 0] as [number, number] };
    expect(reachPreview(centred, scaled, inset)).toEqual({ ...centred, at: [40, 25] });
  });

  it("leaves a strip that meets no model, or has no direction, as it is", () => {
    const strip = {
      modelId: BLOCK.id,
      at: [30, 20] as [number, number],
      to: [30, 0] as [number, number],
    };
    expect(reachPreview(strip, BLOCK, at(Array(16).fill(false)))).toEqual(strip);
    const still = { ...strip, to: strip.at };
    expect(reachPreview(still, BLOCK, inset)).toEqual(still);
  });

  it("finds a turned model's surface, counting faces at its bottom", () => {
    // A floor at the model's bottom over y 0–5 of its 20 × 10; turned a quarter, it covers x 5–10 of 10 × 20.
    const floor = new Float32Array([0, 0, 0, 20, 0, 0, 20, 5, 0, 0, 0, 0, 20, 5, 0, 0, 5, 0]);
    const turned: Model = { ...BLOCK, placement: { ...BLOCK.placement, rotation: [0, 0, 90] } };
    const preview = modelHeightmap(floor, BLOCK.bounds, [0, 0, 90], 200);
    if (!preview) throw new Error("the floor has a preview");
    expect(preview).toMatchObject({ columns: 10, rows: 20 });
    const left = {
      modelId: BLOCK.id,
      at: [20, 30] as [number, number],
      to: [0, 30] as [number, number],
    };
    const right = {
      modelId: BLOCK.id,
      at: [30, 30] as [number, number],
      to: [60, 30] as [number, number],
    };
    expect(reachPreview(left, turned, preview)).toEqual({ ...left, at: [25, 30] });
    expect(reachPreview(right, turned, preview)).toEqual(right);
  });
});
