import type { Path, Shape } from "@furrow/document";
import { describe, expect, it } from "vitest";
import { pathBounds, shapesBounds } from "./bounds";

describe("pathBounds", () => {
  it("is the points of a polyline", () => {
    expect(
      pathBounds({
        start: [1, 2],
        segments: [
          { kind: "line", to: [-3, 5] },
          { kind: "line", to: [4, -1] },
        ],
        closed: false,
      }),
    ).toEqual({ min: [-3, -1], max: [4, 5] });
  });

  it("is a single point's own", () => {
    expect(pathBounds({ start: [7, 8], segments: [], closed: false })).toEqual({
      min: [7, 8],
      max: [7, 8],
    });
  });

  it("covers a full circle", () => {
    const circle: Path = {
      start: [15, 5],
      segments: [{ kind: "arc", to: [15, 5], center: [5, 5], clockwise: false }],
      closed: true,
    };
    expect(pathBounds(circle)).toEqual({ min: [-5, -5], max: [15, 15] });
  });

  it("covers only the quadrants an arc sweeps, in its direction", () => {
    // From (10, 0) to (0, 10) round the origin.
    const arc = (clockwise: boolean): Path => ({
      start: [10, 0],
      segments: [{ kind: "arc", to: [0, 10], center: [0, 0], clockwise }],
      closed: false,
    });
    expect(pathBounds(arc(false))).toEqual({ min: [0, 0], max: [10, 10] });
    expect(pathBounds(arc(true))).toEqual({ min: [-10, -10], max: [10, 10] });
  });

  it("covers where a cubic bulges past its ends", () => {
    // The curve peaks at t = 0.5: 0.375 × 10 + 0.375 × 10 = 7.5.
    expect(
      pathBounds({
        start: [0, 0],
        segments: [{ kind: "cubic", c1: [0, 10], c2: [10, 10], to: [10, 0] }],
        closed: false,
      }),
    ).toEqual({ min: [0, 0], max: [10, 7.5] });
  });
});

describe("shapesBounds", () => {
  const shape = (start: [number, number]): Shape => ({
    id: "00000000-0000-4000-8000-000000000000",
    name: "",
    layer: "0",
    paths: [{ start, segments: [], closed: false }],
  });

  it("joins every shape's paths, or is null without any", () => {
    expect(shapesBounds([shape([1, 9]), shape([-4, 2])])).toEqual({ min: [-4, 2], max: [1, 9] });
    expect(shapesBounds([])).toBeNull();
  });
});
