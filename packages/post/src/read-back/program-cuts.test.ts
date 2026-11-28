import { heightmapGrid, simulateCuts, type Vec3 } from "@furrow/cam-core";
import type { Stock } from "@furrow/document";
import { describe, expect, it } from "vitest";
import { ProgramReadError, programCuts } from "./program-cuts";

const STOCK: Stock = {
  width: 100,
  height: 100,
  thickness: 10,
  xyOrigin: { anchor: "bottom_left" },
  zOrigin: "stock_top",
  touchOff: null,
  twoSided: null,
  tabs: null,
};
const TOOL = "(Furrow tool: type=flat_end_mill diameter=6)";
/** A program that starts with the tool known, at X10 Y10 Z5. */
const program = (...lines: string[]) => [TOOL, "G0 Z5", "G0 X10 Y10", ...lines].join("\n");

/** Segment `i` of `cut` as its two points. */
function segment(cut: { segments: Float32Array }, i: number): [Vec3, Vec3] {
  const s = [...cut.segments.slice(i * 6, i * 6 + 6)].map((v) => Math.round(v * 1000) / 1000);
  return [s.slice(0, 3) as Vec3, s.slice(3) as Vec3];
}

function points(cut: { segments: Float32Array }): Vec3[] {
  const all: Vec3[] = [];
  for (let i = 0; i < cut.segments.length / 6; i++) all.push(...segment(cut, i));
  return all;
}

function readError(gcode: string): { line: number; reason: string } {
  try {
    programCuts(gcode, STOCK);
  } catch (error) {
    if (error instanceof ProgramReadError) return { line: error.line, reason: error.reason };
    throw error;
  }
  throw new Error("read without an error");
}

describe("programCuts", () => {
  it("reads moves into stock coordinates, each with its line", () => {
    const stock: Stock = { ...STOCK, xyOrigin: { anchor: "center" } };
    const { cuts, lines, warnings } = programCuts(program("G1 Z-1 F300", "X20"), stock);
    expect(cuts).toHaveLength(1);
    expect(cuts[0]?.tool).toEqual({
      type: "flat_end_mill",
      diameter: 6,
      vAngle: null,
      tipDiameter: null,
      taperAngle: null,
    });
    const cut = cuts[0] as (typeof cuts)[number];
    // The rapid that makes the position known comes down from above the stock top.
    expect(segment(cut, 0)).toEqual([
      [60, 60, 5],
      [60, 60, 5],
    ]);
    expect(segment(cut, 1)).toEqual([
      [60, 60, 5],
      [60, 60, -1],
    ]);
    expect(segment(cut, 2)).toEqual([
      [60, 60, -1],
      [70, 60, -1],
    ]);
    expect([...(lines[0] as Uint32Array)]).toEqual([3, 4, 5]);
    expect(warnings).toEqual([]);
  });

  it("starts a cut at every tool comment", () => {
    const gcode = program(
      "(Operation: Rough)",
      "G1 Z-1 F300",
      "M0 (Change the bit)",
      "(Furrow tool: type=v_bit diameter=12 vAngle=60 tipDiameter=0.2)",
      "(Operation: Chamfer)",
      "G0 Z5",
      "G1 Z-1",
    );
    const { cuts, lines } = programCuts(gcode, STOCK);
    expect(cuts.map(({ tool }) => [tool.type, tool.vAngle, tool.tipDiameter])).toEqual([
      ["flat_end_mill", null, null],
      ["v_bit", 60, 0.2],
    ]);
    // The pause is still made with the end mill; the V-bit's cut starts after its comment.
    expect(lines.map((cut) => [...cut])).toEqual([
      [3, 5],
      [9, 10],
    ]);
  });

  it("reads Marlin's comments and hand-written words", () => {
    const gcode = [
      "; Furrow tool: type=ball_end_mill diameter=3",
      "g0 z5",
      "G0X.5 Y1 ; to the start",
      "M0 Change the bit",
      "M117 Cutting, 1/4 inch bit",
    ].join("\n");
    const { cuts, warnings } = programCuts(gcode, STOCK);
    expect(cuts[0]?.tool.type).toBe("ball_end_mill");
    expect(segment(cuts[0] as (typeof cuts)[number], 0)[1]).toEqual([0.5, 1, 5]);
    expect(warnings).toEqual([]);
  });

  it("splits G2 and G3 arcs into chords on their circle, ending at their end point", () => {
    // From X10 Y10: clockwise about X20 Y10, or anticlockwise about X10 Y20, or the long way.
    const arcs = [
      ["G2 X20 Y20 I10", [20, 10]],
      ["G3 X20 Y20 J10", [10, 20]],
      ["G2 X20 Y20 R10", [20, 10]],
      ["G3 X20 Y20 R-10", [20, 10]],
    ] as const;
    for (const [code, centre] of arcs) {
      const cut = programCuts(program("G1 Z-1 F300", code), STOCK).cuts[0] as {
        segments: Float32Array;
      };
      const arc = points(cut).slice(4);
      expect(arc.length).toBeGreaterThan(20);
      expect(arc.at(-1)).toEqual([20, 20, -1]);
      for (const [x, y, z] of arc) {
        expect(Math.hypot(x - centre[0], y - centre[1])).toBeCloseTo(10, 2);
        expect(z).toBe(-1);
      }
    }
  });

  it("takes the longer arc for a negative R, and a full circle when the arc ends where it starts", () => {
    const longer = programCuts(program("G1 Z-1 F300", "G2 X20 Y20 R-10"), STOCK).cuts[0];
    const shorter = programCuts(program("G1 Z-1 F300", "G2 X20 Y20 R10"), STOCK).cuts[0];
    expect(longer?.segments.length).toBeGreaterThan(2.5 * (shorter?.segments.length as number));
    const circle = programCuts(program("G1 Z-1 F300", "G2 X10 Y10 I5"), STOCK).cuts[0] as {
      segments: Float32Array;
    };
    const xs = points(circle).map(([x]) => x);
    // Marlin's full circle with only its centre.
    const centreOnly = programCuts(program("G1 Z-1 F300", "G2 I5"), STOCK);
    expect(points(centreOnly.cuts[0] as { segments: Float32Array }).map(([x]) => x)).toEqual(
      expect.arrayContaining([expect.closeTo(20, 2)]),
    );
    expect(centreOnly.lines[0]?.at(-1)).toBe(5);
    // GRBL refuses both forms, so they warn; one with only R cuts nothing.
    expect(centreOnly.warnings).toEqual([{ line: 5, code: "unsupported", word: "G2" }]);
    const radiusOnly = programCuts(program("G1 Z-1 F300", "G3 R5"), STOCK);
    expect(radiusOnly.warnings).toEqual([{ line: 5, code: "unsupported", word: "G3" }]);
    expect(radiusOnly.lines[0]?.at(-1)).toBe(4);
    expect(Math.max(...xs)).toBeCloseTo(20, 2);
    expect(Math.min(...xs)).toBeCloseTo(10, 2);
  });

  it("arcs in the G18 and G19 planes, rising evenly along the third axis", () => {
    const xz = points(
      programCuts(program("G18 G2 X20 Z5 I5 Y14"), STOCK).cuts[0] as { segments: Float32Array },
    ).slice(4);
    for (const [x, , z] of xz) expect(Math.hypot(x - 15, z - 5)).toBeCloseTo(5, 2);
    const ys = xz.map(([, y]) => y);
    expect(ys.at(-1)).toBe(14);
    expect(ys.every((y, i) => i === 0 || y >= (ys[i - 1] as number))).toBe(true);
    const yz = points(
      programCuts(program("G19 G3 Y20 Z5 J5"), STOCK).cuts[0] as { segments: Float32Array },
    ).slice(4);
    for (const [x, y, z] of yz) {
      expect(x).toBe(10);
      expect(Math.hypot(y - 15, z - 5)).toBeCloseTo(5, 2);
    }
  });

  it("stops at an arc that can't reach its end point", () => {
    expect(readError(program("G1 Z-1 F300", "G2 X40 Y10 R5"))).toEqual({
      line: 5,
      reason: "badArc",
    });
    expect(readError(program("G1 Z-1 F300", "G2 X20 Y10 I3"))).toEqual({
      line: 5,
      reason: "badArc",
    });
    expect(readError(program("G2 X20 Y10"))).toEqual({ line: 4, reason: "badArc" });
    // A radius so large its chords round to nothing.
    expect(readError(program("G2 X10 Y10 I100000000000000000000"))).toEqual({
      line: 4,
      reason: "badArc",
    });
  });

  it("reads inches and relative moves", () => {
    const cut = programCuts(program("G20 G91 G1 X1 Z-0.1 F10", "G21 G90 X0"), STOCK).cuts[0] as {
      segments: Float32Array;
    };
    expect(segment(cut, 1)).toEqual([
      [10, 10, 5],
      [35.4, 10, 2.46],
    ]);
    expect(segment(cut, 2)[1]).toEqual([0, 10, 2.46]);
  });

  it("cuts nothing after G53 until a rapid makes the axes known again", () => {
    const gcode = program("G53 G0 Z-2", "G0 X30", "G0 Z1", "G1 Z-1 F300");
    const { cuts, lines, warnings } = programCuts(gcode, STOCK);
    expect(warnings).toEqual([{ line: 4, code: "unknownPosition", word: "G53" }]);
    const cut = cuts[0] as { segments: Float32Array };
    // X30 leaves Z unknown; Z1 comes down from the stock top to it.
    expect(segment(cut, 1)).toEqual([
      [30, 10, 1],
      [30, 10, 1],
    ]);
    expect([...(lines[0] as Uint32Array)]).toEqual([3, 6, 7]);
    expect(readError(program("G53 G0 Z-2", "G1 X30 F300"))).toEqual({
      line: 5,
      reason: "unknownStart",
    });
  });

  it("forgets every axis after G28, probing or an offset", () => {
    const { warnings } = programCuts(
      program("G28", "G0 X1 Y1 Z5", "G38.2 Z-10 F50", "G0 X1 Y1 Z5", "G43 H1"),
      STOCK,
    );
    expect(warnings).toEqual([
      { line: 4, code: "unknownPosition", word: "G28" },
      { line: 6, code: "unknownPosition", word: "G38.2" },
      { line: 8, code: "unknownPosition", word: "G43" },
    ]);
    expect(readError(program("G92 X0", "G1 X5 F300"))).toEqual({ line: 5, reason: "unknownStart" });
  });

  it("follows a block that zeroes where the tool is, probes and retracts (G10 L20)", () => {
    const block = [
      TOOL,
      "G21",
      "G10 L20 P0 X0 Y0 Z0 (set current location to zero)",
      "G0 X10 Y10 F2000",
      "M0 (MSG Attach probe)",
      "G38.2 Z-110 F200 P0.5",
      "G1 Z10 F900",
      "M62 P1",
      "G1 X20 Z-1",
    ].join("\n");
    const { cuts, warnings } = programCuts(block, STOCK);
    expect(warnings).toEqual([{ line: 6, code: "unknownPosition", word: "G38.2" }]);
    const cut = cuts[0] as { segments: Float32Array };
    // G10 L20 makes X0 Y0 Z0 known; the probe loses Z only, and the retract above
    // the stock finds it again, so the feed after it is cut.
    expect(segment(cut, 0)[1]).toEqual([10, 10, 0]);
    expect(segment(cut, 2)).toEqual([
      [10, 10, 10],
      [20, 10, -1],
    ]);
    // Into the stock from an unknown height, a feed can't be followed.
    expect(readError(program("G38.2 Z-110 F200", "G1 Z-1 F300"))).toEqual({
      line: 5,
      reason: "unknownStart",
    });
    // `L2` moves the zero by a machine position: the axes it names are lost.
    expect(programCuts(program("G10 L2 P1 Z-50"), STOCK).warnings).toEqual([
      { line: 4, code: "unknownPosition", word: "G10" },
    ]);
  });

  it("loses the axes a controller command may move, e.g. FluidNC's $HZ or a macro", () => {
    const { warnings } = programCuts(
      program("M63 P1 (stop spindle pin27)", "$HZ", "G0 Z5", "G1 X20 F300", "M30"),
      STOCK,
    );
    // M63 only switches an output, here the spindle's pin.
    expect(warnings).toEqual([{ line: 5, code: "unknownPosition", word: "$HZ" }]);
    // Homing Z keeps X and Y: once a move sets Z, feeds are followed again.
    expect(readError(program("$HZ", "G1 X20 F300"))).toEqual({ line: 5, reason: "unknownStart" });
    // A macro may move anywhere.
    expect(readError(program("$LocalFS/Run=probe-xyz.nc", "G0 Z20", "G1 X20 F300"))).toEqual({
      line: 6,
      reason: "unknownStart",
    });
  });

  it("skips words it doesn't support, saying which and where", () => {
    const { warnings, cuts } = programCuts(program("G41 G1 X20 A10 F300", "M8", "M106"), STOCK);
    expect(warnings).toEqual([
      { line: 4, code: "unsupported", word: "G41" },
      { line: 4, code: "unsupported", word: "A10" },
      { line: 6, code: "unsupported", word: "M106" },
    ]);
    expect(segment(cuts[0] as { segments: Float32Array }, 1)[1]).toEqual([20, 10, 5]);
  });

  it("stops at a line it can't read, a move before any tool, or a tool it can't read", () => {
    expect(readError(program("G1 X Y2"))).toEqual({ line: 4, reason: "unreadable" });
    expect(readError(`G0 X1 Y1 Z1\n${TOOL}`)).toEqual({ line: 1, reason: "noTool" });
    expect(readError("(Furrow tool: type=spoon diameter=6)")).toEqual({
      line: 1,
      reason: "badTool",
    });
    for (const fields of [
      "type=v_bit",
      "type=v_bit diameter=12",
      "type=v_bit diameter=12 vAngle=180",
      "type=tapered_ball_end_mill diameter=3 tipDiameter=0.5",
      "type=tapered_ball_end_mill diameter=3 taperAngle=5",
      "type=flat_end_mill diameter=3 tipDiameter=-1",
    ]) {
      expect(readError(`(Furrow tool: ${fields})`)).toEqual({ line: 1, reason: "badTool" });
    }
    expect(readError(["G80", TOOL, "G0 X1 Y1 Z1", "G80", "X2"].join("\n"))).toEqual({
      line: 5,
      reason: "noMotion",
    });
  });

  it("shows what a custom block cuts and where a wrong zero puts the cut", () => {
    const grid = heightmapGrid(STOCK, 6, 10_000);
    const height = (gcode: string, stock: Stock, x: number, y: number) => {
      const { heights } = simulateCuts(stock, programCuts(gcode, stock).cuts, grid);
      const column = Math.floor(x / grid.cellWidth);
      const row = Math.floor(y / grid.cellHeight);
      return heights[row * grid.columns + column];
    };
    const plain = program("G0 Z5");
    const plunge = program("G1 Z-3 F300", "G0 Z5");
    expect(height(plain, STOCK, 10, 10)).toBe(0);
    expect(height(plunge, STOCK, 10, 10)).toBeCloseTo(-3);
    const centred: Stock = { ...STOCK, xyOrigin: { anchor: "center" } };
    expect(height(plunge, centred, 10, 10)).toBe(0);
    expect(height(plunge, centred, 60, 60)).toBeCloseTo(-3);
  });
});
