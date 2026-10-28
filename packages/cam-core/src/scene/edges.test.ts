import type { FlipAxis, Point, Stock, StockCorner } from "@furrow/document";
import { fullDocument } from "@furrow/document/fixtures";
import { describe, expect, it } from "vitest";
import { edgeSetup, flipPoint } from "./sides";

/** A two-sided 300 × 200 mm stock zeroed at its centre, lined up by `corner`. */
function stock(flipAxis: FlipAxis, corner: StockCorner | null = "bottom_right"): Stock {
  const doc = fullDocument();
  return {
    ...doc.stock,
    xyOrigin: { anchor: "center" },
    twoSided: { flipAxis, partingDepth: 9, pins: null, edges: corner },
  };
}

/**
 * Where the bottom side cuts the material the top side cut at `point`,
 * relative to it, when the stock in the fence corner is `real` in size but
 * the project says `planned`: the program places stock coordinates from the
 * corner as planned, the material sits from the corner as it really is.
 */
function mismatch(planned: Stock, real: Pick<Stock, "width" | "height">, point: Point): Point {
  const setup = edgeSetup(planned);
  if (!setup) throw new Error("no edges");
  const right = setup.corner.endsWith("right");
  const top = setup.corner.startsWith("top");
  // From planned stock coordinates to the real stock's, both from the fence corner.
  const shift: Point = [
    right ? real.width - planned.width : 0,
    top ? real.height - planned.height : 0,
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
      across: "height",
    });
    expect(edgeSetup(stock("y", "top_left"))).toEqual({
      corner: "top_left",
      offset: [150, -100],
      across: "width",
    });
    expect(edgeSetup(stock("x", null))).toBeNull();
  });

  it.each(["x", "y"] as FlipAxis[])(
    "meets exactly when the stock is the planned size, and is off by the error across the axis, about %s",
    (axis) => {
      for (const corner of ["bottom_left", "bottom_right", "top_left", "top_right"] as const) {
        const planned = stock(axis, corner);
        expect(mismatch(planned, planned, [37, 151])).toEqual([0, 0]);
        // 1 mm too wide and 2 mm too tall: only the size across the flip axis shows.
        // Which way depends on the corner; how far doesn't.
        const off = mismatch(planned, { width: 301, height: 202 }, [37, 151]).map(Math.abs);
        expect(off).toEqual(axis === "x" ? [0, 2] : [1, 0]);
        expect(edgeSetup(planned)?.across).toBe(axis === "x" ? "height" : "width");
      }
    },
  );
});
