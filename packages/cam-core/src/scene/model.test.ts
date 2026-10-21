import { MODEL_BORDER, type ModelPlacement } from "@furrow/document";
import { DRAWING_ID, model } from "@furrow/document/fixtures";
import { describe, expect, it } from "vitest";
import {
  designAlignment,
  designBounds,
  fitScale,
  initialPlacement,
  modelAt,
  modelBorder,
  modelRect,
  modelTransform,
  placedModelBox,
  type Rotation,
  replacePlacement,
  rotatedBounds,
  rotatedSize,
  stockFit,
  turnModel,
} from "./model";
import type { Box3, Vec3 } from "./stock";

/** The fixture's 100 × 80 × 12 mesh, from (-50, -40, 0). */
const BOUNDS = model.bounds as Box3;
const stock = { width: 400, height: 200, thickness: 18 };

function placed(placement: Partial<ModelPlacement>) {
  return { ...model, placement: { ...model.placement, ...placement } };
}

function apply(matrix: number[], [x, y, z]: Vec3): Vec3 {
  const row = (r: number) =>
    (matrix[r * 4] as number) * x +
    (matrix[r * 4 + 1] as number) * y +
    (matrix[r * 4 + 2] as number) * z +
    (matrix[r * 4 + 3] as number);
  return [row(0) + 0, row(1) + 0, row(2) + 0];
}

describe("rotatedBounds", () => {
  it("swaps and mirrors axes by quarter turns", () => {
    expect(rotatedBounds(BOUNDS, [0, 0, 0])).toEqual(BOUNDS);
    // About Z: x' = -y, y' = x.
    expect(rotatedBounds(BOUNDS, [0, 0, 90])).toEqual({ min: [-40, -50, 0], max: [40, 50, 12] });
    // About X: y' = -z, z' = y.
    expect(rotatedBounds(BOUNDS, [90, 0, 0])).toEqual({ min: [-50, -12, -40], max: [50, 0, 40] });
    expect(rotatedSize(BOUNDS, [90, 0, 0])).toEqual([100, 12, 80]);
    expect(rotatedSize(BOUNDS, [0, 90, 0])).toEqual([12, 80, 100]);
  });
});

describe("turnModel", () => {
  it("adds a quarter turn about the stock's axes", () => {
    expect(turnModel([0, 0, 0], 2)).toEqual([0, 0, 90]);
    expect(turnModel([0, 0, 270], 2)).toEqual([0, 0, 0]);
    expect(turnModel([0, 0, 0], 0)).toEqual([90, 0, 0]);
  });

  it("turns about the stock's axis, not the model's, after other turns", () => {
    // After a turn about Z, a turn about X is applied last: it isn't the first turn of three.
    const rotation = turnModel([0, 0, 90], 0);
    const size = rotatedSize(BOUNDS, rotation);
    // 100 × 80 × 12 turned about Z is 80 × 100 × 12, then about X 80 × 12 × 100.
    expect(size).toEqual([80, 12, 100]);
  });

  it("comes back after four turns about any axis", () => {
    const start: Rotation = [90, 180, 0];
    for (const axis of [0, 1, 2] as const) {
      let rotation = start;
      for (let i = 0; i < 4; i++) rotation = turnModel(rotation, axis);
      expect(rotatedBounds(BOUNDS, rotation)).toEqual(rotatedBounds(BOUNDS, start));
    }
  });
});

describe("placedModelBox and modelTransform", () => {
  it("scales X and Y, stretches Z to the depth and puts the top at the stock top", () => {
    const m = placed({ scale: 2, depth: 6, position: [10, 20] });
    expect(placedModelBox(m)).toEqual({ min: [10, 20, -6], max: [210, 180, 0] });
    expect(modelRect(m)).toEqual({ min: [10, 20], max: [210, 180] });
    const transform = modelTransform(m);
    expect(apply(transform, [-50, -40, 0])).toEqual([10, 20, -6]);
    expect(apply(transform, [50, 40, 12])).toEqual([210, 180, 0]);
  });

  it("rotates before scaling", () => {
    const m = placed({ rotation: [0, 0, 90], scale: 1, depth: 12, position: [0, 0] });
    expect(placedModelBox(m)).toEqual({ min: [0, 0, -12], max: [80, 100, 0] });
    // The mesh's +X end is its +Y end once turned.
    expect(apply(modelTransform(m), [50, 0, 12])).toEqual([40, 100, 0]);
  });

  it("puts a flat model on the stock top", () => {
    const bounds: Box3 = { min: [0, 0, 3], max: [10, 10, 3] };
    const flat = { ...placed({ depth: 5 }), bounds };
    expect(placedModelBox(flat)).toEqual({ min: [0, 0, 0], max: [10, 10, 0] });
    expect(apply(modelTransform(flat), [10, 10, 3])).toEqual([10, 10, 0]);
  });
});

describe("initialPlacement", () => {
  it("fits inside the stock less a border and aligns to it at the anchor", () => {
    // 100 × 80 into 400 × 200 with a 10 mm border, so 380 × 180: the length limits it, to 2.25.
    expect(fitScale(BOUNDS, [0, 0, 0], stock)).toBe(2.5);
    expect(initialPlacement(BOUNDS, stock, "bottom_left", MODEL_BORDER)).toEqual({
      rotation: [0, 0, 0],
      scale: 2.25,
      // 12 mm scaled by 2.25, deeper than the 18 mm stock: never squashed to fit.
      depth: 27,
      position: [10, 10],
    });
    // 225 × 180 placed.
    expect(initialPlacement(BOUNDS, stock, "center", MODEL_BORDER).position).toEqual([87.5, 10]);
    expect(initialPlacement(BOUNDS, stock, "top_right", MODEL_BORDER).position).toEqual([165, 10]);
    expect(initialPlacement(BOUNDS, stock, "middle_left", MODEL_BORDER).position).toEqual([10, 10]);
  });
});

describe("modelBorder", () => {
  it("is 10 mm, never more than a quarter of the stock's smaller side", () => {
    expect(modelBorder(stock)).toBe(10);
    expect(modelBorder({ width: 30, height: 100 })).toBe(7.5);
  });

  it("takes the model's own border, within the same cap", () => {
    expect(modelBorder(stock, 0)).toBe(0);
    expect(modelBorder(stock, 25)).toBe(25);
    expect(modelBorder({ width: 30, height: 100 }, 25)).toBe(7.5);
  });
});

describe("stockFit", () => {
  it("fits a turned mesh inside the border of a small stock", () => {
    // Turned a quarter about Z: 80 × 100 into 40 × 40 less 10 mm, so 20 × 20.
    expect(stockFit(BOUNDS, [0, 0, 90], { width: 40, height: 40 }, "bottom_left")).toEqual({
      scale: 0.2,
      position: [10, 10],
    });
    expect(stockFit(BOUNDS, [0, 0, 90], { width: 40, height: 40 }, "top_right")).toEqual({
      scale: 0.2,
      position: [14, 10],
    });
  });

  it("fits edge to edge with no border, or leaves the border given", () => {
    // 80 × 100 into 40 × 40 whole: 0.4, so 32 × 40, aligned top right.
    expect(stockFit(BOUNDS, [0, 0, 90], { width: 40, height: 40 }, "top_right", 0)).toEqual({
      scale: 0.4,
      position: [8, 0],
    });
    // Into 40 × 40 less 5 mm a side: 30 × 30, so 0.3.
    expect(stockFit(BOUNDS, [0, 0, 90], { width: 40, height: 40 }, "bottom_left", 5)).toEqual({
      scale: 0.3,
      position: [5, 5],
    });
  });
});

describe("replacePlacement", () => {
  it("keeps the model's point at the anchor where it is", () => {
    const m = placed({ position: [50, 60] });
    const centre = [100, 100];
    const turned = replacePlacement(m, { rotation: [0, 0, 90] }, "center");
    const r = modelRect({ ...m, placement: turned });
    expect([(r.min[0] + r.max[0]) / 2, (r.min[1] + r.max[1]) / 2]).toEqual(centre);
    const scaled = replacePlacement(m, { scale: 2 }, "bottom_left");
    expect(scaled.position).toEqual([50, 60]);
    expect(scaled.scale).toBe(2);
  });

  it("scales the depth with the outline, so the mesh keeps its proportions", () => {
    // 12 mm high at scale 1, stored squashed to 6 mm.
    const m = placed({ depth: 6 });
    expect(replacePlacement(m, { scale: 2 }, "center").depth).toBe(24);
    // Turned on its side, the 80 mm length is the height.
    expect(replacePlacement(m, { rotation: [90, 0, 0] }, "center").depth).toBe(80);
  });
});

describe("designBounds and designAlignment", () => {
  it("align the drawing and the models as one", () => {
    const m = placed({ position: [300, 100] });
    const square = {
      id: "square",
      name: "square",
      layer: "0",
      drawingId: DRAWING_ID,
      paths: [
        {
          start: [10, 10] as [number, number],
          segments: [{ kind: "line" as const, to: [20, 20] as [number, number] }],
          closed: false,
        },
      ],
    };
    expect(designBounds([square], [m])).toEqual({ min: [10, 10], max: [400, 180] });
    expect(designBounds([], [])).toBeNull();
    expect(designAlignment(stock, [square], [m], "bottom_left")).toEqual([-10, -10]);
    expect(designAlignment(stock, [], [], "center")).toEqual([0, 0]);
  });
});

describe("modelAt", () => {
  it("finds the last model whose outline holds the point", () => {
    const a = { ...placed({ position: [0, 0] }), id: "a" };
    const b = { ...placed({ position: [50, 0] }), id: "b" };
    expect(modelAt([a, b], [10, 10])?.id).toBe("a");
    expect(modelAt([a, b], [60, 10])?.id).toBe("b");
    expect(modelAt([a, b], [100, 80])?.id).toBe("b");
    expect(modelAt([a, b], [200, 10])).toBeNull();
  });
});
