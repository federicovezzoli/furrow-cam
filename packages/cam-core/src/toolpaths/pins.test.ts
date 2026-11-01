import type { FlipAxis, Operation, PinHoles, ProjectDocument } from "@furrow/document";
import { drill, fullDocument, reliefRough } from "@furrow/document/fixtures";
import { describe, expect, it } from "vitest";
import { flipPoint, pinCenters } from "../scene/sides";
import { stockOffset } from "../scene/stock";
import {
  checkPins,
  generateToolpath,
  PINS_WARNING,
  type ToolpathInput,
  toolpathInputs,
} from "./generate";
import type { Toolpath } from "./toolpath";

const THROUGH: PinHoles = { type: "through", spoilboardDepth: 5 };

/** A two-sided 300 × 200 × 18 mm project, zeroed at its bottom-left corner, whose only operation drills its pins. */
function project(
  flipAxis: FlipAxis,
  holes: PinHoles | null = THROUGH,
  positions = [-80, 60],
): ProjectDocument {
  const doc = fullDocument();
  const lineUp = holes && { type: "pins" as const, diameter: 6, positions, holes };
  return {
    ...doc,
    stock: {
      ...doc.stock,
      xyOrigin: { anchor: "bottom_left" },
      touchOff: null,
      twoSided: { flipAxis, partingDepth: 9, lineUp, tabs: null },
    },
    operations: [
      {
        ...(doc.operations[0] as Operation),
        type: "drill",
        tool: drill,
        stockSide: "top",
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
    },
  );

  it("drills blind holes as deep as the pin settings say, whatever the drill's own depth", () => {
    expect(holes(project("x", { type: "blind", depth: 8 })).bottom).toBeCloseTo(-8);
  });

  it("warns when a pin is off the stock, along the flip axis or across it", () => {
    const warnings = (doc: ProjectDocument) =>
      generateToolpath(toolpathInputs(doc)[0] as ReturnType<typeof toolpathInputs>[number])
        .warnings;
    expect(warnings(project("x"))).toEqual([]);
    // 300 mm along X: a 6 mm pin 148 mm from the centre reaches past the edge.
    expect(warnings(project("x", THROUGH, [-80, 148]))).toEqual([
      { code: "toolpath.pinsOffStock" },
    ]);
    const narrow = project("x");
    narrow.stock.height = 4;
    expect(warnings(narrow)).toEqual([{ code: "toolpath.pinsOffStock" }]);
  });

  describe("warns when a bottom-side operation cuts deep enough to reach a pin", () => {
    /** The warnings of `doc`'s pin drill and of `operation` added to it, each as the worker gives them. */
    const warnings = (doc: ProjectDocument, operation: Operation) => {
      doc.operations.push(operation);
      return toolpathInputs(doc).map((input) => checkPins(input, generateToolpath(input)).warnings);
    };
    // The square's outside profile, 18 mm deep, its top edge along y = 100, the flip axis.
    const profile = fullDocument().operations[0] as Operation;
    const bottom = { ...profile, stockSide: "bottom" } as Operation;
    const pocket = {
      ...bottom,
      type: "pocket",
      params: {
        side: "outside",
        strategy: { type: "offset" },
        direction: "climb",
        stepOver: 40,
        depth: 6,
        allowance: 0,
        finishPass: false,
        ramp: false,
      },
    } as Operation;

    it("through the square's edge, but not on the top side, nor for pins away from it", () => {
      // A pin at x = 30, on the square's top edge; the others at x = 250 and 290, clear of it.
      expect(warnings(project("x", THROUGH, [-120, 60]), bottom)).toEqual([[], [PINS_WARNING]]);
      expect(warnings(project("x", THROUGH, [-120, 60]), profile)).toEqual([[], []]);
      expect(warnings(project("x", THROUGH, [100, 140]), bottom)).toEqual([[], []]);
    });

    it("clearing outside the shapes, the shapes flipped", () => {
      expect(warnings(project("x", THROUGH, [100, 140]), pocket)).toEqual([[], [PINS_WARNING]]);
    });

    it("only past the stock a blind pin leaves above it", () => {
      const blind: PinHoles = { type: "blind", depth: 5 };
      // The pins fill the last 5 mm of the 18 mm stock: a 6 mm pocket stays clear.
      expect(warnings(project("x", blind, [100, 140]), pocket)).toEqual([[], []]);
      expect(warnings(project("x", blind, [-120, 60]), bottom)).toEqual([[], [PINS_WARNING]]);
    });

    it("from a 3D toolpath's cuts, and not from moves above the stock", () => {
      const [, input] = toolpathInputs(
        Object.assign(project("x", THROUGH, [-120, 60]), {
          operations: [project("x").operations[0], bottom],
        }),
      );
      const relief = {
        ...(input as ToolpathInput),
        operation: { ...reliefRough, stockSide: "bottom" as const },
      };
      // Across the pin at x = 30, y = 100.
      const across = (z: number): Toolpath => ({
        moves: [
          { kind: "rapid", to: [20, 100, 5] },
          { kind: "feed", to: [20, 100, z], feedRate: 1000 },
          { kind: "feed", to: [40, 100, z], feedRate: 1000 },
        ],
        warnings: [],
      });
      expect(checkPins(relief, across(-1)).warnings).toEqual([PINS_WARNING]);
      expect(checkPins(relief, across(1)).warnings).toEqual([]);
    });
  });

  it("warns when the project has no pins to drill", () => {
    const [input] = toolpathInputs(project("x", null));
    expect(generateToolpath(input as NonNullable<typeof input>)).toEqual({
      moves: [],
      warnings: [{ code: "toolpath.noLocatingPins" }],
    });
  });
});
