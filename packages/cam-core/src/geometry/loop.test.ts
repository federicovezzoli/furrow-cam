import type { Point } from "@furrow/document";
import { describe, expect, it } from "vitest";
import { projectOnLoop } from "./loop";

describe("projectOnLoop", () => {
  it("measures how far along the loop the nearest point is", () => {
    const loop: Point[] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 0],
    ];
    expect(projectOnLoop(loop, [12, 4])).toEqual({
      point: [10, 4],
      at: 14,
      distance: 2,
      tangent: [0, 1],
    });
  });
});
