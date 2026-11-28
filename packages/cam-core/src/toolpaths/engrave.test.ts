import type { EngraveOperation, EngraveParams, Shape, Tool } from "@furrow/document";
import {
  ballEndMill,
  DRAWING_ID,
  endMill,
  fullDocument,
  taperedBallEndMill,
  vBit,
} from "@furrow/document/fixtures";
import { describe, expect, it } from "vitest";
import { simulateCuts } from "../simulation/simulation";
import {
  engraveToolpath,
  exceedsVBitCone,
  grooveWidth,
  maxChamferWidth,
  vBitConeDepth,
  vBitDepthForWidth,
  vBitLineWidth,
} from "./engrave";
import { generateToolpath, toolpathCuts, toolpathInputs } from "./generate";
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
    stockSide: "top",
    type: "engrave",
    targets: shapes.map((shape) => ({ shapeId: shape.id, paths: null })),
    tool,
    params: {
      side: "on",
      depth: 1,
      width: null,
      ramp: false,
      startPoints: [],
      taper: null,
      ...params,
    },
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
    const operation = engraving([square, line], { depth: 3, ramp: true, startPoints: [[90, 10]] });
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
            startPoints: [{ start: [90, 10], plunge: null }],
            cornerOvercuts: null,
          },
        },
        [square, line],
        options,
      ),
    );
  });

  it("warns how many closed paths it skips as too small inside or outside", () => {
    const tiny: Shape = {
      ...square,
      id: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
      paths: [
        {
          start: [150, 0],
          segments: [
            { kind: "line", to: [151, 0] },
            { kind: "line", to: [151, 1] },
            { kind: "line", to: [150, 1] },
          ],
          closed: true,
        },
      ],
    };
    expect(engrave([square, tiny], { side: "inside" }).warnings).toEqual([
      { code: "toolpath.skippedSmallPaths", values: { count: 1 } },
    ]);
    expect(engrave([square, tiny], { side: "outside" }).warnings).toEqual([]);
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
        parting: null,
        flip: null,
        tabs: null,
        reachesOther: false,
        loose: false,
        before: [],
        touchOff: null,
        pins: null,
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

describe("fluting", () => {
  /** The flute's final depth along `line` (x from 10 to 90), 3 mm deep. */
  const profile = (start: number, end: number) => (x: number) =>
    3 * Math.min(1, start > 0 ? (x - 10) / start : 1, end > 0 ? (90 - x) / end : 1);

  /** The lowest the tool centre goes at `x` along `line`, from the feed moves. */
  function lowestAt(toolpath: Toolpath, x: number): number {
    let lowest = 0;
    let at: readonly number[] | null = null;
    for (const move of toolpath.moves) {
      if (move.kind === "feed" && at) {
        const [x0, , z0] = at as [number, number, number];
        const [x1, , z1] = move.to;
        if ((x0 - x) * (x1 - x) <= 0 && x0 !== x1) {
          lowest = Math.min(lowest, z0 + ((z1 - z0) * (x - x0)) / (x1 - x0));
        } else if (x0 === x && x1 === x) lowest = Math.min(lowest, z0, z1);
      }
      at = move.to;
    }
    return lowest;
  }

  it("ramps in and out along an open path, never below the ramp", () => {
    const toolpath = engrave([line], { depth: 3, taper: { start: 20, end: 30 } }, ballEndMill);
    expect(toolpath.warnings).toEqual([]);
    const depth = profile(20, 30);
    for (let x = 10; x <= 90; x += 0.5) {
      expect(-lowestAt(toolpath, x)).toBeCloseTo(depth(x), 6);
    }
  });

  it("cuts each pass only where the flute goes deeper than the pass before", () => {
    const toolpath = engrave([line], { depth: 3, taper: { start: 20, end: 30 } }, ballEndMill);
    // Three 1 mm passes: the last cuts only where the flute is deeper than 2 mm.
    const deepest = toolpath.moves.filter((move) => move.kind === "feed" && move.to[2] < -2);
    const xs = deepest.map((move) => move.to[0]);
    expect(Math.min(...xs)).toBeGreaterThan(10 + (20 * 2) / 3 - 1e-9);
    expect(Math.max(...xs)).toBeLessThan(90 - (30 * 2) / 3 + 1e-9);
  });

  it("peaks where the ramps meet when they are longer than the path", () => {
    const toolpath = engrave([line], { depth: 3, taper: { start: 80, end: 80 } }, ballEndMill);
    // A pointed flute: halfway along, half as deep.
    expect(lowestAt(toolpath, 50)).toBeCloseTo(-1.5, 9);
    expect(Math.min(...toolpath.moves.map((move) => move.to[2]))).toBeCloseTo(-1.5, 9);
    expect(lowestAt(toolpath, 30)).toBeCloseTo(-0.75, 9);
  });

  it("starts at the drawn end a start point picks, the taper staying on the path", () => {
    const toolpath = engrave(
      [line],
      { depth: 3, taper: { start: 0, end: 40 }, startPoints: [[90, 10]] },
      ballEndMill,
    );
    const feeds = toolpath.moves.filter((move) => move.kind === "feed");
    // Each pass starts from the shallow end, the one at x = 90.
    expect(feeds[0]?.to).toEqual([90, 10, 0]);
    const depth = profile(0, 40);
    for (let x = 10; x <= 90; x += 0.5) {
      expect(-lowestAt(toolpath, x)).toBeCloseTo(depth(x), 6);
    }
    // Full depth at the start of the path, plunged there (at the plunge rate).
    expect(lowestAt(toolpath, 10)).toBeCloseTo(-3, 9);
  });

  it("ramps in only where the flute is deep enough, never into the shallow end", () => {
    const short: Shape = {
      ...line,
      paths: [{ start: [10, 10], segments: [{ kind: "line", to: [20, 10] }], closed: false }],
    };
    const toolpath = engrave(
      [short],
      { depth: 3, ramp: true, taper: { start: 0, end: 8 } },
      ballEndMill,
    );
    const depth = (x: number) => 3 * Math.min(1, (20 - x) / 8);
    for (let x = 10; x <= 20; x += 0.25) {
      expect(lowestAt(toolpath, x)).toBeGreaterThanOrEqual(-depth(x) - 1e-9);
    }
    expect(lowestAt(toolpath, 10)).toBeCloseTo(-3, 9);
  });

  it("goes down steeper than the plunge angle at the plunge rate", () => {
    const toolpath = engrave([line], { depth: 3, taper: { start: 5, end: 5 } }, ballEndMill);
    // Going down the 5 mm ramp in, 3 mm deep: steeper than the 3° plunge angle.
    const steep = toolpath.moves.filter(
      (move, i) =>
        move.kind === "feed" &&
        move.to[0] > 10 &&
        move.to[0] <= 15 &&
        move.to[2] < (toolpath.moves[i - 1]?.to[2] ?? 0),
    );
    expect(steep.length).toBeGreaterThan(0);
    expect(
      steep.every((move) => move.kind === "feed" && move.feedRate === ballEndMill.plungeRate),
    ).toBe(true);
  });

  it("cuts closed paths at one depth", () => {
    const flat = engrave([square], { depth: 3 });
    expect(engrave([square], { depth: 3, taper: { start: 20, end: 20 } })).toEqual(flat);
  });

  it("widens and narrows a V-bit's groove with the depth", () => {
    const sharp: Tool = { ...vBit, vAngle: 90, diameter: 12, stepDown: 3 };
    const operation = engraving([line], { depth: 3, taper: { start: 30, end: 30 } }, sharp);
    const toolpath = engraveToolpath(operation, [line], options);
    expect(toolpath.warnings).toEqual([]);
    const grid = { columns: 1000, rows: 200, cellWidth: 0.1, cellHeight: 0.1 };
    const stock = simulateCuts(
      { width: 100, height: 20, thickness: 18 },
      toolpathCuts(operation, toolpath),
      grid,
    );
    /** The groove's width on the stock top at `x`. */
    const widthAt = (x: number) => {
      const column = Math.floor(x / 0.1);
      let cut = 0;
      for (let row = 0; row < 200; row++) {
        if ((stock.heights[row * 1000 + column] as number) < -1e-6) cut++;
      }
      return cut * 0.1;
    };
    // 90°: twice as wide as deep, ramping in over 30 mm.
    expect(widthAt(25.05)).toBeCloseTo(2 * profile(30, 30)(25.05), 0);
    expect(widthAt(50.05)).toBeCloseTo(6, 0);
    expect(widthAt(80.05)).toBeCloseTo(2 * profile(30, 30)(80.05), 0);
    expect(widthAt(25.05)).toBeLessThan(widthAt(35.05));
  });
});

describe("chamfer", () => {
  /** A 60 × 60 mm part with a 20 × 20 mm hole, on a 100 × 100 mm stock. */
  const part: Shape = {
    ...square,
    paths: [
      {
        start: [20, 20],
        segments: [
          { kind: "line", to: [80, 20] },
          { kind: "line", to: [80, 80] },
          { kind: "line", to: [20, 80] },
        ],
        closed: true,
      },
      {
        start: [40, 40],
        segments: [
          { kind: "line", to: [60, 40] },
          { kind: "line", to: [60, 60] },
          { kind: "line", to: [40, 60] },
        ],
        closed: true,
      },
    ],
  };
  const sharp: Tool = { ...vBit, vAngle: 90, diameter: 6, tipDiameter: 0 };
  const flat: Tool = { ...sharp, tipDiameter: 1 };

  /** The stock top along y = 50 after the chamfer, as a function of x. */
  function topAlong(tool: Tool, width: number) {
    const operation = engraving([part], { side: "chamfer", width }, tool);
    const toolpath = engraveToolpath(operation, [part], options);
    expect(toolpath.warnings).toEqual([]);
    const grid = { columns: 2000, rows: 1, cellWidth: 0.05, cellHeight: 100 };
    const stock = simulateCuts(
      { width: 100, height: 100, thickness: 18 },
      toolpathCuts(operation, toolpath),
      grid,
    );
    // The single row is centred on y = 50, which crosses the left edges at x = 20 and 40.
    return (x: number) => stock.heights[Math.floor(x / 0.05)] as number;
  }

  for (const tool of [sharp, flat]) {
    it(`bevels the outer contour and the hole \`width\` wide on the top, tip ${tool.tipDiameter}`, () => {
      const top = topAlong(tool, 2);
      // 90°: as deep as wide, on the line.
      expect(top(20.01)).toBeCloseTo(-2, 1);
      expect(top(21)).toBeCloseTo(-1, 1);
      expect(top(21.9)).toBeLessThan(0);
      expect(top(22.1)).toBe(0);
      // The hole's edge is bevelled into the part, outside the hole.
      expect(top(39.99)).toBeCloseTo(-2, 1);
      expect(top(38.1)).toBeLessThan(0);
      expect(top(37.9)).toBe(0);
      expect(top(30)).toBe(0);
    });
  }

  it("cuts outside the line by half the tip's flat, as deep as the width needs", () => {
    const toolpath = engrave([square], { side: "chamfer", width: 2 }, flat);
    // Two passes of the 2 mm step-down down to 2 mm, the tip 0.5 mm outside.
    expect(feedsAt(toolpath, -2)).toContainEqual([100.5, 0]);
    expect(toolpath.moves.every((move) => move.to[2] >= -2 - 1e-9)).toBe(true);
  });

  it("warns when the width needs more than the cone", () => {
    // 6 mm and no tip: up to 3 mm.
    expect(engrave([square], { side: "chamfer", width: 3 }, sharp).warnings).toEqual([]);
    const wide = engrave([square], { side: "chamfer", width: 4 }, sharp);
    expect(wide.warnings).toEqual([{ code: "toolpath.chamferConeWide" }]);
    expect(Math.min(...wide.moves.map((move) => move.to[2]))).toBeCloseTo(-3, 9);
  });

  it("doesn't warn for a chamfer as wide as the cone, despite rounding", () => {
    // 2 × 0.55 + 0.35 is a hair over 1.45 in floating point.
    const small: Tool = { ...sharp, diameter: 1.45, tipDiameter: 0.35 };
    expect(maxChamferWidth(small)).toBeCloseTo(0.55, 12);
    expect(engrave([square], { side: "chamfer", width: 0.55 }, small).warnings).toEqual([]);
    expect(maxChamferWidth(endMill)).toBeNull();
  });

  it("warns when the chamfer goes deeper than the stock", () => {
    const warnings = (thickness: number) => {
      const doc = fullDocument();
      const [profile] = doc.operations;
      if (!profile) throw new Error("fullDocument has an operation");
      // 30°: a 1 mm chamfer is 1 / tan 15° ≈ 3.7 mm deep.
      const narrow: Tool = { ...sharp, vAngle: 30 };
      doc.stock.thickness = thickness;
      doc.operations = [
        {
          ...engraving([], { side: "chamfer", width: 1 }, narrow),
          targets: profile.targets,
        },
      ];
      const [input] = toolpathInputs(doc);
      return input && generateToolpath(input).warnings;
    };
    expect(warnings(18)).toEqual([]);
    expect(warnings(3)).toEqual([{ code: "toolpath.chamferThroughStock" }]);
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

  it("is a tapered ball end mill's ball chord, then the cone's width, then its diameter", () => {
    const { tipDiameter, taperAngle, diameter } = taperedBallEndMill;
    const r = (tipDiameter as number) / 2;
    const angle = ((taperAngle as number) * Math.PI) / 180;
    // Within the ball: its chord.
    expect(grooveWidth(taperedBallEndMill, 0.1)).toBeCloseTo(
      2 * Math.sqrt(r * r - (r - 0.1) ** 2),
      12,
    );
    // Up the cone: widens by tan(angle) per side for every mm deeper.
    const tangentHeight = r * (1 - Math.sin(angle));
    expect(grooveWidth(taperedBallEndMill, 5)).toBeCloseTo(
      2 * (r * Math.cos(angle) + (5 - tangentHeight) * Math.tan(angle)),
      12,
    );
    expect(grooveWidth(taperedBallEndMill, 1000)).toBe(diameter);
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
