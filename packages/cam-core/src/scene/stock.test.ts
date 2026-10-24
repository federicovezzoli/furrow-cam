import type { Shape, Stock, StockAnchor } from "@furrow/document";
import { DRAWING_ID } from "@furrow/document/fixtures";
import { describe, expect, it } from "vitest";
import { flattenPath } from "../geometry/flatten";
import { importSvg } from "../import/svg/import";
import {
  alignShapes,
  anchorAlignment,
  anchorPoint,
  stockBounds,
  stockBox,
  stockOffset,
  xyOriginPosition,
  xyOriginShift,
} from "./stock";

const stock: Stock = {
  width: 600,
  height: 400,
  thickness: 18,
  xyOrigin: { anchor: "bottom_left" },
  zOrigin: "stock_top",
  touchOff: null,
  twoSided: null,
};

describe("stock placement", () => {
  it("puts the bottom-left corner of the stock top at the origin by default", () => {
    expect(stockOffset(stock)).toEqual([0, 0, 0]);
    expect(stockBounds(stock)).toEqual({ min: [0, 0, -18], max: [600, 400, 0] });
  });

  it("centres the stock on the origin and rests it on the bed", () => {
    const centered: Stock = { ...stock, xyOrigin: { anchor: "center" }, zOrigin: "machine_bed" };
    expect(stockOffset(centered)).toEqual([-300, -200, 18]);
    expect(stockBounds(centered)).toEqual({ min: [-300, -200, 0], max: [300, 200, 18] });
    expect(stockBox(centered)).toEqual({ min: [0, 0, -18], max: [600, 400, 0] });
  });

  it.each<[StockAnchor, [number, number]]>([
    ["bottom_left", [0, 0]],
    ["bottom_center", [300, 0]],
    ["bottom_right", [600, 0]],
    ["middle_left", [0, 200]],
    ["center", [300, 200]],
    ["middle_right", [600, 200]],
    ["top_left", [0, 400]],
    ["top_center", [300, 400]],
    ["top_right", [600, 400]],
  ])("puts the %s anchor at %j on the stock", (anchor, [x, y]) => {
    const anchored: Stock = { ...stock, xyOrigin: { anchor } };
    expect(xyOriginPosition(anchored)).toEqual([x, y]);
    expect(stockOffset(anchored)).toEqual([0 - x, 0 - y, 0]);
    expect(stockBounds(anchored)).toEqual({
      min: [0 - x, 0 - y, -18],
      max: [600 - x, 400 - y, 0],
    });
  });

  it("moves anchors with the stock when it is resized", () => {
    const topRight: Stock = { ...stock, xyOrigin: { anchor: "top_right" } };
    expect(stockOffset({ ...topRight, width: 800, height: 300 })).toEqual([-800, -300, 0]);
    const topCenter: Stock = { ...stock, xyOrigin: { anchor: "top_center" } };
    expect(stockOffset({ ...topCenter, width: 500 })).toEqual([-250, -400, 0]);
  });

  it("keeps a custom zero at its stock position when the stock is resized", () => {
    const custom: Stock = { ...stock, xyOrigin: { anchor: "custom", x: 120, y: 35.5 } };
    expect(stockOffset(custom)).toEqual([-120, -35.5, 0]);
    expect(stockOffset({ ...custom, width: 200, height: 100 })).toEqual([-120, -35.5, 0]);
    expect(stockBounds({ ...custom, zOrigin: "machine_bed" })).toEqual({
      min: [-120, -35.5, 0],
      max: [480, 364.5, 18],
    });
  });

  it("allows a custom zero outside the stock", () => {
    const fence: Stock = { ...stock, xyOrigin: { anchor: "custom", x: -20, y: 450 } };
    expect(stockOffset(fence)).toEqual([20, -450, 0]);
    expect(stockBounds(fence)).toEqual({ min: [20, -450, -18], max: [620, -50, 0] });
  });
});

describe("anchorPoint", () => {
  it("measures from the rectangle's corner", () => {
    const rect = { min: [-10, 20] as [number, number], max: [30, 60] as [number, number] };
    expect(anchorPoint(rect, "bottom_left")).toEqual([-10, 20]);
    expect(anchorPoint(rect, "center")).toEqual([10, 40]);
    expect(anchorPoint(rect, "top_right")).toEqual([30, 60]);
  });
});

describe("anchorAlignment", () => {
  /** A 20 × 10 rectangle centred on (0, 0). */
  const part: Shape = {
    id: "00000000-0000-4000-8000-000000000000",
    name: "",
    layer: "0",
    drawingId: DRAWING_ID,
    paths: [
      {
        start: [-10, -5],
        segments: [
          { kind: "line", to: [10, -5] },
          { kind: "line", to: [10, 5] },
          { kind: "line", to: [-10, 5] },
        ],
        closed: true,
      },
    ],
  };

  it.each<[StockAnchor, [number, number]]>([
    ["bottom_left", [10, 5]],
    ["center", [300, 200]],
    ["top_right", [590, 395]],
    ["middle_left", [10, 200]],
  ])("puts the drawing's %s on the stock's", (anchor, offset) => {
    expect(anchorAlignment(stock, [part], anchor)).toEqual(offset);
  });

  it("doesn't move an aligned drawing, or no drawing", () => {
    expect(anchorAlignment({ width: 20, height: 10 }, [part], "top_right")).toEqual([10, 5]);
    expect(anchorAlignment(stock, [], "center")).toEqual([0, 0]);
  });

  it("aligns shapes, keeping the array when they already are", () => {
    const [aligned] = alignShapes(stock, [part], "center");
    expect(aligned?.paths[0]?.start).toEqual([290, 195]);
    const shapes = [part];
    expect(alignShapes({ width: 20, height: 10 }, shapes, "center")).not.toBe(shapes);
    const centred = alignShapes({ width: 0, height: 0 }, shapes, "center");
    expect(centred).toBe(shapes);
  });
});

describe("anchorAlignment of curves", () => {
  it("puts an SVG drawn with quadratics exactly on its anchor", () => {
    const { shapes } = importSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="50mm" viewBox="0 0 100 50">' +
        '<path d="M3.3 30.7 Q 15.1 2.3 29.7 27.1 T 61.3 19.9"/></svg>',
    );
    for (const anchor of ["bottom_left", "top_right"] as const) {
      const points = alignShapes(stock, shapes, anchor).flatMap((shape) =>
        shape.paths.flatMap((path) => flattenPath(path, 1e-4)),
      );
      const xs = points.map((point) => point[0]);
      const ys = points.map((point) => point[1]);
      const [x, y] = anchorPoint({ min: [0, 0], max: [stock.width, stock.height] }, anchor);
      const [bx, by] =
        anchor === "bottom_left"
          ? [Math.min(...xs), Math.min(...ys)]
          : [Math.max(...xs), Math.max(...ys)];
      expect(bx).toBeCloseTo(x, 3);
      expect(by).toBeCloseTo(y, 3);
    }
  });
});

describe("anchorAlignment rounding", () => {
  it("is exactly zero for a drawing aligned up to float noise", () => {
    const shape: Shape = {
      id: "00000000-0000-4000-8000-000000000000",
      name: "",
      layer: "0",
      drawingId: DRAWING_ID,
      paths: [
        { start: [0.1 + 0.2, 0], segments: [{ kind: "line", to: [0.7, 0.4] }], closed: false },
      ],
    };
    expect(anchorAlignment({ width: 1, height: 0.4 }, [shape], "center")).toEqual([0, 0]);
  });
});

describe("xyOriginShift", () => {
  it("is how far an anchored zero moves with the stock, and nothing for a custom zero", () => {
    const centred: Stock = { ...stock, xyOrigin: { anchor: "center" } };
    expect(xyOriginShift(centred, { ...centred, width: 400 })).toEqual([-100, 0]);
    expect(xyOriginShift(stock, { ...stock, height: 100 })).toEqual([0, 0]);
    const custom: Stock = { ...stock, xyOrigin: { anchor: "custom", x: 5, y: 5 } };
    expect(xyOriginShift(custom, { ...custom, width: 100 })).toEqual([0, 0]);
  });
});
