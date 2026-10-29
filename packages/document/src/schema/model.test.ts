import { describe, expect, it } from "vitest";
import { model } from "./fixtures";
import { Model, Sha256 } from "./model";

describe("Sha256", () => {
  it("accepts 64 lowercase hex digits only", () => {
    expect(Sha256.safeParse(model.sha256).success).toBe(true);
    expect(Sha256.safeParse(model.sha256.toUpperCase()).success).toBe(false);
    expect(Sha256.safeParse(model.sha256.slice(1)).success).toBe(false);
    expect(Sha256.safeParse(`${model.sha256.slice(1)}g`).success).toBe(false);
    // Object keys are built from it, so nothing that could leave the project's prefix.
    expect(Sha256.safeParse(`../${model.sha256.slice(3)}`).success).toBe(false);
  });
});

describe("Model", () => {
  it("accepts an imported model", () => {
    expect(Model.parse(model)).toEqual(model);
  });

  it("accepts a flat model", () => {
    const flat = { ...model, bounds: { min: [0, 0, 5], max: [10, 10, 5] } };
    expect(Model.safeParse(flat).success).toBe(true);
  });

  it("rejects inverted bounds", () => {
    const inverted = { ...model, bounds: { min: [0, 0, 12], max: [10, 10, 0] } };
    expect(Model.safeParse(inverted).error?.issues).toEqual([
      expect.objectContaining({ path: ["bounds"] }),
    ]);
  });

  it("accepts quarter turns only, and a positive scale and depth", () => {
    const placed = (placement: object) => ({
      ...model,
      placement: { ...model.placement, ...placement },
    });
    expect(Model.safeParse(placed({ rotation: [90, 180, 270] })).success).toBe(true);
    expect(Model.safeParse(placed({ rotation: [45, 0, 0] })).success).toBe(false);
    expect(Model.safeParse(placed({ rotation: [360, 0, 0] })).success).toBe(false);
    expect(Model.safeParse(placed({ scale: 0 })).success).toBe(false);
    expect(Model.safeParse(placed({ depth: -1 })).success).toBe(false);
  });

  it("needs a border of zero or more", () => {
    expect(Model.safeParse({ ...model, border: 0 }).success).toBe(true);
    expect(Model.safeParse({ ...model, border: -1 }).success).toBe(false);
    const { border: _, ...withoutBorder } = model;
    expect(Model.safeParse(withoutBorder).success).toBe(false);
  });

  it("rejects empty files, fractional counts and unknown keys", () => {
    expect(Model.safeParse({ ...model, size: 0 }).success).toBe(false);
    expect(Model.safeParse({ ...model, triangles: 1.5 }).success).toBe(false);
    expect(Model.safeParse({ ...model, url: "https://example.com/emblem.stl" }).success).toBe(
      false,
    );
  });
});
