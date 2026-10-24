import type { FlipAxis } from "@furrow/document";
import { model } from "@furrow/document/fixtures";
import { describe, expect, it } from "vitest";
import { applyAffine } from "../geometry/affine";
import { modelTransform, type PlacedModel } from "./model";
import { bottomModelTransform, flipPoint } from "./sides";
import type { Vec3 } from "./stock";

const stock = { width: 400, height: 200, thickness: 18 };
const AXES: FlipAxis[] = ["x", "y"];

describe("flipPoint", () => {
  it("turns the stock over about X: y and z change, x stays", () => {
    expect(flipPoint(stock, "x", [10, 20, 0])).toEqual([10, 180, -18]);
    expect(flipPoint(stock, "x", [10, 20, -5])).toEqual([10, 180, -13]);
  });

  it("turns the stock over about Y: x and z change, y stays", () => {
    expect(flipPoint(stock, "y", [10, 20, 0])).toEqual([390, 20, -18]);
    expect(flipPoint(stock, "y", [10, 20, -5])).toEqual([390, 20, -13]);
  });

  it.each(AXES)("keeps the stock in place and maps back to where it started, about %s", (axis) => {
    const centre: Vec3 = [200, 100, -9];
    expect(flipPoint(stock, axis, centre)).toEqual(centre);
    const point: Vec3 = [37, 151, -4];
    expect(flipPoint(stock, axis, flipPoint(stock, axis, point))).toEqual(point);
  });
});

describe("bottomModelTransform", () => {
  // The fixture's 100 × 80 × 12 mesh from (-50, -40, 0), placed at (0, 0) 12 mm deep.
  const top: Vec3 = [-50, -40, 12];
  const bottom: Vec3 = [-50, -40, 0];

  it.each(AXES)("places the model as seen from below, about %s", (axis) => {
    const transform = bottomModelTransform(model, stock, axis);
    for (const point of [top, bottom, [50, 40, 6] as Vec3]) {
      expect(applyAffine(transform, point)).toEqual(
        flipPoint(stock, axis, applyAffine(modelTransform(model), point)),
      );
    }
  });

  it.each(AXES)("turns, scales and moves the model before flipping it, about %s", (axis) => {
    const turned = {
      ...model,
      placement: { rotation: [90, 0, 270] as const, scale: 1.5, depth: 15, position: [30, 20] },
    } as PlacedModel;
    const transform = bottomModelTransform(turned, stock, axis);
    for (const point of [top, bottom, [50, 40, 6] as Vec3, [-10, 25, 3] as Vec3]) {
      const placed = applyAffine(modelTransform(turned), point);
      expect(applyAffine(transform, point)).toEqual(flipPoint(stock, axis, placed));
    }
    // Rotated about X the mesh's 80 mm length becomes its height, scaled to the 15 mm depth.
    const zs = [top, bottom].map((point) => applyAffine(transform, point)[2]);
    expect(Math.min(...zs)).toBeGreaterThanOrEqual(-18);
    expect(Math.max(...zs)).toBeLessThanOrEqual(-3);
  });

  it("reaches up from the bottom side's floor", () => {
    const transform = bottomModelTransform(model, stock, "x");
    // The model's top, on the top side's stock top, lies on the floor.
    expect(applyAffine(transform, top)).toEqual([0, 200, -18]);
    expect(applyAffine(transform, bottom)).toEqual([0, 200, -6]);
  });

  it("puts a model through the whole stock with its bottom on the bottom face", () => {
    const deep = { ...model, placement: { ...model.placement, depth: stock.thickness } };
    expect(applyAffine(bottomModelTransform(deep, stock, "y"), bottom)).toEqual([400, 0, 0]);
  });
});
