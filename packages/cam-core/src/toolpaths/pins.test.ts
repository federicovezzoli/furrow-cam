import type { FlipAxis, Operation, PinHoles, ProjectDocument } from "@furrow/document";
import { drill, fullDocument } from "@furrow/document/fixtures";
import { describe, expect, it } from "vitest";
import { flipPoint, pinCenters } from "../scene/sides";
import { stockOffset } from "../scene/stock";
import { generateToolpath, toolpathInputs } from "./generate";

const THROUGH: PinHoles = { type: "through", spoilboardDepth: 5 };

/** A two-sided 300 × 200 × 18 mm project, zeroed at its bottom-left corner, whose only operation drills its pins. */
function project(
  flipAxis: FlipAxis,
  holes: PinHoles | null = THROUGH,
  stockSide: Operation["stockSide"] = "top",
): ProjectDocument {
  const doc = fullDocument();
  const pins = holes && { diameter: 6, positions: [-80, 60], holes };
  return {
    ...doc,
    stock: {
      ...doc.stock,
      xyOrigin: { anchor: "bottom_left" },
      touchOff: null,
      twoSided: { flipAxis, partingDepth: 9, pins },
    },
    operations: [
      {
        ...(doc.operations[0] as Operation),
        type: "drill",
        tool: drill,
        stockSide,
        targets: [],
        params: { depth: 1, peck: false, stepOver: 40, pins: true },
      },
    ],
  };
}

/** Where `doc`'s only operation plunges deepest, in work coordinates, and how deep. */
function holes(doc: ProjectDocument) {
  const [input] = toolpathInputs(doc);
  const { moves } = generateToolpath(input as NonNullable<typeof input>);
  const offset = stockOffset(doc.stock);
  const bottom = Math.min(...moves.map(({ to }) => to[2]));
  return {
    bottom,
    at: moves
      .filter(({ to }) => to[2] === bottom)
      .map(({ to }) => [to[0] + offset[0], to[1] + offset[1]]),
  };
}

describe("locating pins", () => {
  it.each(["x", "y"] as FlipAxis[])(
    "drill holes the turned-over stock lands on, at the same machine positions, about %s",
    (axis) => {
      const doc = project(axis);
      const centers = pinCenters(doc.stock);
      expect(centers).toEqual(
        axis === "x"
          ? [
              [70, 100],
              [210, 100],
            ]
          : [
              [150, 20],
              [150, 160],
            ],
      );
      const top = holes(doc);
      // Through the stock and 5 mm into the spoilboard.
      expect(top.bottom).toBeCloseTo(-23);
      expect(top.at).toEqual(centers);
      // Turned over, each hole is where it was, and the bottom side keeps the top side's zero.
      for (const [x, y] of centers as [number, number][]) {
        expect(flipPoint(doc.stock, axis, [x, y, 0]).slice(0, 2)).toEqual([x, y]);
      }
      expect(holes(project(axis, THROUGH, "bottom")).at).toEqual(top.at);
    },
  );

  it("drills blind holes as deep as the pin settings say, whatever the drill's own depth", () => {
    expect(holes(project("x", { type: "blind", depth: 8 })).bottom).toBeCloseTo(-8);
  });

  it("warns when the project has no pins to drill", () => {
    const [input] = toolpathInputs(project("x", null));
    expect(generateToolpath(input as NonNullable<typeof input>)).toEqual({
      moves: [],
      warnings: [{ code: "toolpath.noLocatingPins" }],
    });
  });
});
