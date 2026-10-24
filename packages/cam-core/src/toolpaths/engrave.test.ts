import type { EngraveOperation, EngraveParams, Shape, Tool } from "@furrow/document";
import { DRAWING_ID, endMill, vBit } from "@furrow/document/fixtures";
import { describe, expect, it } from "vitest";
import {
  engraveToolpath,
  exceedsVBitCone,
  grooveWidth,
  vBitConeDepth,
  vBitDepthForWidth,
  vBitLineWidth,
} from "./engrave";
import { generateToolpath } from "./generate";
import { profileToolpath } from "./profile";
import type { Toolpath } from "./toolpath";

/** 100 × 100 mm, counter-clockwise. */
const square: Shape = {
  id: "4f8a1c2e-6b3d-4e5f-9a7b-8c9d0e1f2a3b",
  name: "Square",
  layer: "0",
  drawingId: DRAWING_ID,
  paths: [
    {
      start: [0, 0],
      segments: [
        { kind: "line", to: [100, 0] },
        { kind: "line", to: [100, 100] },
        { kind: "line", to: [0, 100] },
      ],
      closed: true,
    },
  ],
};

const line: Shape = {
  id: "0d9c8b7a-6f5e-4d3c-ab1a-0f9e8d7c6b5a",
  name: "Stroke",
  layer: "0",
  drawingId: DRAWING_ID,
  paths: [{ start: [10, 10], segments: [{ kind: "line", to: [90, 10] }], closed: false }],
};

const options = { safeZ: 5, entryClearance: 1 };

function engraving(
  shapes: Shape[],
  params: Partial<EngraveParams> = {},
  tool: Tool = endMill,
): EngraveOperation {
  return {
    id: "11111111-2222-4333-8444-555555555555",
    name: "Engrave",
    enabled: true,
    side: "top",
    type: "engrave",
    targets: shapes.map((shape) => ({ shapeId: shape.id, paths: null })),
    tool,
    params: { side: "on", depth: 1, ramp: false, ...params },
  };
}

function engrave(shapes: Shape[], params: Partial<EngraveParams> = {}, tool?: Tool): Toolpath {
  return engraveToolpath(engraving(shapes, params, tool), shapes, options);
}

/** Feed moves at height `z`, as 2D points. */
function feedsAt(toolpath: Toolpath, z: number): [number, number][] {
  return toolpath.moves
    .filter((move) => move.kind === "feed" && Math.abs(move.to[2] - z) < 1e-9)
    .map((move) => [move.to[0], move.to[1]]);
}

describe("engraveToolpath", () => {
  it("follows an open path on the line, alternating direction per pass", () => {
    const toolpath = engrave([line], { depth: 3 });
    expect(toolpath.warnings).toEqual([]);
    // Two passes no deeper than the 2 mm step-down.
    expect(feedsAt(toolpath, -1.5)).toEqual([
      [10, 10],
      [90, 10],
    ]);
    expect(feedsAt(toolpath, -3)).toEqual([
      [90, 10],
      [10, 10],
    ]);
  });

  it("follows a closed path on the line, climb milling", () => {
    const toolpath = engrave([square]);
    const points = feedsAt(toolpath, -1);
    for (const [x, y] of points) {
      expect(x === 0 || x === 100 || y === 0 || y === 100).toBe(true);
    }
    // Clockwise around the outline: the line itself is on the tool's right.
    const area = points.reduce((sum, [x, y], i) => {
      const [nx, ny] = points[(i + 1) % points.length] as [number, number];
      return sum + x * ny - nx * y;
    }, 0);
    expect(area).toBeLessThan(0);
  });

  it("cuts open paths before closed ones", () => {
    const toolpath = engrave([square, line]);
    expect(toolpath.moves.find((move) => move.kind === "feed")?.to.slice(0, 2)).toEqual([10, 10]);
  });

  it("is the profile on the line", () => {
    const operation = engraving([square, line], { depth: 3, ramp: true });
    expect(operation.params.side).toBe("on");
    expect(engraveToolpath(operation, [square, line], options)).toEqual(
      profileToolpath(
        {
          ...operation,
          type: "profile",
          params: {
            side: "on",
            direction: "climb",
            depth: 3,
            allowance: 0,
            finishPass: false,
            leadIn: null,
            ramp: true,
            tabs: null,
          },
        },
        [square, line],
        options,
      ),
    );
  });

  it("keeps an edge of the groove on the line inside and outside", () => {
    // 60° V-bit 1 mm deep: a line 2·tan(30°) wide, its centre half that off the path.
    const half = Math.tan(Math.PI / 6);
    const outside = feedsAt(engrave([square], { side: "outside" }, vBit), -1);
    const inside = feedsAt(engrave([square], { side: "inside" }, vBit), -1);
    const extent = (points: [number, number][]) => [
      Math.min(...points.map((p) => p[0])),
      Math.min(...points.map((p) => p[1])),
      Math.max(...points.map((p) => p[0])),
      Math.max(...points.map((p) => p[1])),
    ];
    const [min, , max] = extent(inside);
    expect(min).toBeCloseTo(half, 3);
    expect(max).toBeCloseTo(100 - half, 3);
    // Outside corners are rounded, so the straight edges give the extent.
    const [omin, , omax] = extent(outside);
    expect(omin).toBeCloseTo(-half, 3);
    expect(omax).toBeCloseTo(100 + half, 3);
    // A flat end mill is offset by its radius, whatever the depth.
    const flat = feedsAt(engrave([square], { side: "inside", depth: 0.2 }), -0.2);
    expect(extent(flat)[0]).toBeCloseTo(endMill.diameter / 2, 3);
  });

  it("skips open paths inside and outside, with a warning", () => {
    const toolpath = engrave([square, line], { side: "outside" });
    expect(toolpath.warnings).toEqual([
      { code: "toolpath.skippedOpenProfile", values: { count: 1 } },
    ]);
    expect(feedsAt(toolpath, -1).some(([, y]) => y === 10)).toBe(false);
  });

  it("runs through generateToolpath", () => {
    const operation = engraving([line]);
    expect(
      generateToolpath({
        operation,
        shapes: [line],
        model: null,
        stock: null,
        stockBottom: null,
        before: [],
        touchOff: null,
        ...options,
      }),
    ).toEqual(engrave([line]));
  });

  it("warns when a V-bit goes deeper than its cone", () => {
    // 60° and 6.35 mm: the cone is 5.5 mm deep.
    expect(engrave([line], { depth: 5 }, vBit).warnings).toEqual([]);
    expect(engrave([line], { depth: 6 }, vBit).warnings).toEqual([
      { code: "toolpath.engraveConeWide" },
    ]);
    expect(engrave([line], { depth: 6 }).warnings).toEqual([]);
  });
});

describe("grooveWidth", () => {
  const ball: Tool = { ...endMill, type: "ball_end_mill", diameter: 6 };

  it("is a V-bit's line width", () => {
    expect(grooveWidth(vBit, 1)).toBe(vBitLineWidth(vBit, 1));
  });

  it("is a ball end mill's chord at the depth, then its diameter", () => {
    // 3 mm radius, 1 mm deep: half-chord √(3² − 2²).
    expect(grooveWidth(ball, 1)).toBeCloseTo(2 * Math.sqrt(5), 12);
    expect(grooveWidth(ball, 3)).toBe(6);
    expect(grooveWidth(ball, 5)).toBe(6);
  });

  it("is a flat end mill's diameter", () => {
    expect(grooveWidth(endMill, 0.1)).toBe(endMill.diameter);
  });
});

describe("V-bit line width", () => {
  const flatTip: Tool = { ...vBit, vAngle: 90, tipDiameter: 0.2, diameter: 6 };

  it("widens from the tip with the cone", () => {
    // 60° included: each side opens by tan(30°) per millimetre of depth.
    expect(vBitLineWidth(vBit, 0)).toBe(0);
    expect(vBitLineWidth(vBit, 1)).toBeCloseTo(2 * Math.tan(Math.PI / 6), 12);
    expect(vBitLineWidth(flatTip, 0)).toBeCloseTo(0.2, 12);
    expect(vBitLineWidth(flatTip, 1)).toBeCloseTo(2.2, 12);
  });

  it("is no wider than the bit", () => {
    expect(vBitLineWidth(flatTip, 10)).toBe(6);
    expect(vBitConeDepth(flatTip)).toBeCloseTo(2.9, 12);
  });

  it("tells when the depth is past the cone, ignoring rounding", () => {
    const cone = vBitConeDepth(flatTip) as number;
    expect(exceedsVBitCone(flatTip, vBitDepthForWidth(flatTip, 6) as number)).toBe(false);
    expect(exceedsVBitCone(flatTip, cone + 1e-12)).toBe(false);
    expect(exceedsVBitCone(flatTip, cone + 0.01)).toBe(true);
    expect(exceedsVBitCone(endMill, 100)).toBe(false);
  });

  it("converts back to the depth, including the tip", () => {
    expect(vBitDepthForWidth(flatTip, 2.2)).toBeCloseTo(1, 12);
    expect(vBitDepthForWidth(flatTip, 6)).toBeCloseTo(2.9, 12);
    for (const depth of [0.1, 0.5, 2, 5]) {
      const width = vBitLineWidth(vBit, depth) as number;
      expect(vBitDepthForWidth(vBit, width)).toBeCloseTo(depth, 12);
    }
  });

  it("has no depth for widths outside the cone", () => {
    expect(vBitDepthForWidth(flatTip, 0.2)).toBeNull();
    expect(vBitDepthForWidth(flatTip, 0.1)).toBeNull();
    expect(vBitDepthForWidth(flatTip, 6.01)).toBeNull();
    expect(vBitDepthForWidth(vBit, 0)).toBeNull();
  });

  it("applies to V-bits only", () => {
    expect(vBitLineWidth(endMill, 1)).toBeNull();
    expect(vBitDepthForWidth(endMill, 1)).toBeNull();
    expect(vBitConeDepth(endMill)).toBeNull();
  });
});
