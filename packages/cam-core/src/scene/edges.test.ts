import type { FlipAxis, Point, Stock, StockCorner } from "@furrow/document";
import { fullDocument } from "@furrow/document/fixtures";
import { describe, expect, it } from "vitest";
import { edgeSetup, flipPoint } from "./sides";
import { xyOriginPosition } from "./stock";

/** A two-sided 300 × 200 mm stock zeroed at its centre, lined up by `corner`. */
function stock(flipAxis: FlipAxis, corner: StockCorner | null = "bottom_right"): Stock {
  const doc = fullDocument();
  return {
    ...doc.stock,
    xyOrigin: { anchor: "center" },
    twoSided: {
      flipAxis,
      partingDepth: 9,
      tabs: null,
      lineUp: corner && { type: "edges", corner },
    },
  };
}

/**
 * Where the bottom side cuts the material the top side cut at `point`,
 * relative to it, when the stock in the fence corner is `real` in size but
 * the project says `planned`. The corner in the fence is where `edgeSetup`
 * puts it, back from the zero by its offset: the program places stock
 * coordinates from it as planned, the material sits from it as it really is.
 */
function mismatch(planned: Stock, real: Pick<Stock, "width" | "height">, point: Point): Point {
  const setup = edgeSetup(planned);
  if (!setup) throw new Error("no fence corner");
  const [zx, zy] = xyOriginPosition(planned);
  const corner: Point = [zx - setup.offset[0], zy - setup.offset[1]];
  // From planned stock coordinates to the real stock's, both from the fence corner.
  const shift: Point = [
    corner[0] > 0 ? real.width - planned.width : 0,
    corner[1] > 0 ? real.height - planned.height : 0,
  ];
  const axis = planned.twoSided?.flipAxis ?? "x";
  const topCut: Point = [point[0] + shift[0], point[1] + shift[1]];
  const [bx, by] = flipPoint(planned, axis, [point[0], point[1], 0]);
  const [mx, my] = flipPoint({ ...real, thickness: planned.thickness }, axis, [
    bx + shift[0],
    by + shift[1],
    0,
  ]);
  return [mx - topCut[0] + 0, my - topCut[1] + 0];
}

describe("edgeSetup", () => {
  it("gives the zero's offset from the corner and the size the sides meet by, for both axes", () => {
    expect(edgeSetup(stock("x"))).toEqual({
      corner: "bottom_right",
      offset: [-150, 100],
      measure: { axis: "y", size: 200 },
    });
    expect(edgeSetup(stock("y", "top_left"))).toEqual({
      corner: "top_left",
      offset: [150, -100],
      measure: { axis: "x", size: 300 },
    });
    expect(edgeSetup(stock("x", null))).toBeNull();
  });

  // 1 mm too wide and 2 mm too tall: only the size across the flip axis
  // shows, away from the fence corner or towards it.
  it.each([
    ["x", { bottom_left: [0, 2], bottom_right: [0, 2], top_left: [0, -2], top_right: [0, -2] }],
    ["y", { bottom_left: [1, 0], bottom_right: [-1, 0], top_left: [1, 0], top_right: [-1, 0] }],
  ] as const)(
    "meets exactly when the stock is the planned size, and is off by its error across the axis, about %s",
    (axis, expected) => {
      for (const [corner, off] of Object.entries(expected)) {
        const planned = stock(axis, corner as StockCorner);
        expect(mismatch(planned, planned, [37, 151])).toEqual([0, 0]);
        expect(mismatch(planned, { width: 301, height: 202 }, [37, 151])).toEqual(off);
      }
    },
  );
});
