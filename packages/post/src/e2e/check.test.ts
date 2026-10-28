import type { Operation } from "@furrow/document";
import { drill, endMill, lowRider, machine } from "@furrow/document/fixtures";
import { describe, expect, it } from "vitest";
import { parseGcode } from "../read-back";
import { type CheckedProject, checkGcode, operationMoves } from "./check";

const holes = {
  id: "10000000-0000-4000-8000-000000000001",
  type: "drill",
  name: "Holes",
  enabled: true,
  stockSide: "top",
  targets: [],
  tool: drill,
  params: { depth: 6, peck: true, stepOver: 40, pins: false },
} satisfies Operation;

const project: CheckedProject = {
  stock: {
    width: 160,
    height: 120,
    thickness: 6,
    xyOrigin: { anchor: "bottom_left" },
    zOrigin: "stock_top",
    touchOff: null,
    twoSided: null,
  },
  machine,
  operations: [
    { ...holes, tool: endMill },
    { ...holes, id: "10000000-0000-4000-8000-000000000002" },
  ],
};

const END_MILL = '(Tool: 1/4" 2-flute upcut, 6.35 mm)';
const DRILL = "(Tool: 6 mm drill, 6 mm)";

/** A program cutting a 2 mm deep slot from X10 to X50 at Y10, then `cuts`, then the end. */
function program(
  cuts: string[] = [],
  { start = ["G21 G90 G94 G17"], end = ["M5", "G0 Z5", "G0 X0 Y0", "M30"] } = {},
) {
  return `${[
    END_MILL,
    ...start,
    "(Operation: Slot)",
    "G0 Z5",
    // The dwell on the same line keeps the line numbers below.
    "M3 S18000 G4 P5",
    "G0 X10 Y10",
    "G0 Z1",
    "G1 Z-2 F500",
    "G1 X50 F1500",
    ...cuts,
    "G0 Z5",
    ...end,
  ].join("\n")}\n`;
}

/** The rules `gcode` breaks, with the line of each. */
function broken(gcode: string, checked = project) {
  return checkGcode(gcode, checked).map(({ line, rule }) => `${line} ${rule}`);
}

describe("checkGcode", () => {
  it("passes a program that keeps every rule", () => {
    expect(checkGcode(program(), project)).toEqual([]);
  });

  it("names the line and the rule", () => {
    expect(checkGcode(program(["G1 Z-7"]), project)).toEqual([
      { line: 10, rule: "stock-bottom", message: "Z-7 is below the stock bottom at Z-6" },
    ]);
  });

  it("refuses commands grbl doesn't write, and text that isn't G-code", () => {
    expect(broken(program(["G2 X60 Y20 I5 J0"]))).toEqual(["10 words", "10 words", "10 words"]);
    expect(broken(program(["T2 M6"]))).toEqual(["10 words", "10 words"]);
    expect(broken(program(["G1 X1.2.3"]))).toEqual(["10 words"]);
  });

  it("refuses moves before the modes are set", () => {
    expect(broken(program([], { start: ["G90 G94 G17"] }))).toContain("4 modes");
  });

  it("measures the stock bottom from the zero", () => {
    const onBed = { ...project, stock: { ...project.stock, zOrigin: "machine_bed" as const } };
    // Zeroed on the bed, the stock top is Z6: the same program goes 2 mm into the bed.
    expect(broken(program(["G1 Z-1"]), onBed)).toContain("10 stock-bottom");
  });

  it("refuses rapids into uncut stock", () => {
    // Down at a point never cut, and across the stock below its top.
    expect(broken(program(["G0 Z5", "G0 X80", "G0 Z-1"]))).toEqual(["12 rapid"]);
    expect(broken(program(["G0 Y30"]))).toEqual(["10 rapid"]);
    // Up out of the slot, but diagonally through the stock beside it.
    expect(broken(program(["G0 X80 Z5"]))).toEqual(["10 rapid"]);
    // Down where the tool cut, but deeper than it did.
    expect(broken(program(["G0 Z5", "G0 X30", "G0 Z-3"]))).toEqual(["12 rapid"]);
  });

  it("lets rapids go where the material was cut away", () => {
    // Back along the slot at its depth, and back into a pecked hole.
    expect(broken(program(["G0 Z-1", "G0 X10"]))).toEqual([]);
    expect(
      broken(
        program([
          "M5",
          "G0 Z5",
          DRILL,
          "M0",
          "M3 S12000 G4 P5",
          "G0 X100 Y60",
          "G0 Z1",
          "G1 Z-3 F300",
          "G0 Z1",
          "G0 Z-2",
          "G1 Z-6",
        ]),
      ),
    ).toEqual([]);
  });

  it("refuses rapids below the stock top from an unknown position", () => {
    expect(broken(`G21 G90 G94 G17\n${END_MILL}\nG0 Z-1\nM30\n`)).toContain("3 rapid");
  });

  it("refuses cuts with no feed rate or faster than the machine", () => {
    expect(broken(program(["G1 X60 F0"]))).toEqual(["10 feed"]);
    // 10000 mm/min in XY and 2500 in Z at most.
    expect(broken(program(["G1 X60 F12000"]))).toEqual(["10 feed"]);
    expect(broken(program(["G1 Z-3 F3000"]))).toEqual(["10 feed"]);
    // Diagonally, neither component is over.
    expect(broken(program(["G1 X52 Z-3 F2700"]))).toEqual([]);
  });

  it("refuses cuts with the spindle off and speeds outside its range", () => {
    expect(broken(program(["M5", "G1 X60"]))).toEqual(["11 spindle"]);
    expect(broken(program(["M3 S40000 G4 P5"]))).toEqual(["10 spindle"]);
    expect(broken(program(["M3"]))).toEqual(["10 spindle"]);
  });

  it("expects no speed for a manual spindle", () => {
    const manual = { ...project, machine: lowRider };
    expect(broken(program(), manual)).toEqual(["5 spindle"]);
    expect(broken(program().replace("M3 S18000", "M3"), manual)).toEqual([]);
  });

  it("waits for the spindle to spin up before moving", () => {
    // Started, then raised to a higher speed, each with no dwell or a short one.
    expect(broken(program().replace(" G4 P5", ""))).toEqual(["6 spin-up"]);
    expect(broken(program(["M3 S24000", "G1 X60"]))).toEqual(["11 spin-up"]);
    expect(broken(program(["M3 S24000 G4 P1", "G1 X60"]))).toEqual(["11 spin-up"]);
    // The same or a lower speed needs none; nor does a machine with no delay.
    expect(broken(program(["M3 S12000", "G1 X60"]))).toEqual([]);
    const none = { ...project, machine: project.machine && { ...project.machine, spinUpDelay: 0 } };
    expect(broken(program().replace(" G4 P5", ""), none)).toEqual([]);
    // Nor a manual spindle, switched on by hand.
    const manual = { ...project, machine: lowRider };
    expect(broken(program().replace(" S18000 G4 P5", ""), manual)).toEqual([]);
    // GRBL dwells after the spindle change in a block, whatever the word order.
    expect(broken(program().replace("M3 S18000 G4 P5", "G4 P5 M3 S18000"))).toEqual([]);
    // A P word belongs to G4 only.
    expect(broken(program(["G1 X60 P2"]))).toEqual(["10 words"]);
  });

  it("pauses only with the tool up and, unless it's manual, the spindle off", () => {
    expect(broken(program(["M0"]))).toEqual(["10 pause", "10 pause"]);
    expect(broken(program(["G0 Z5", "M0"]))).toEqual(["11 pause"]);
    const manual = { ...project, machine: lowRider };
    expect(broken(program(["G0 Z5", "M0"]).replace("M3 S18000", "M3"), manual)).toEqual([]);
  });

  it("refuses a new tool that cuts before a pause, and tools not in the project", () => {
    expect(broken(program(["M5", "G0 Z5", DRILL, "M3 S12000 G4 P5", "G1 Z-3"]))).toEqual([
      "14 tool-change",
    ]);
    expect(broken(program(['(Tool: 1/8" end mill, 3.175 mm)']))).toEqual(["10 tool-change"]);
  });

  it("ends with M30, the spindle off and the tool up", () => {
    expect(broken(program([], { end: ["M5"] }))).toEqual(["11 end"]);
    expect(broken(program([], { end: ["M30"] }))).toEqual(["11 end"]);
    expect(broken(program([], { end: ["M5", "M30", "G0 X0"] }))).toEqual(["13 end"]);
  });

  it("refuses programs that span more than the machine's travel", () => {
    expect(broken(program(["G0 Z5", "G0 X900"]))).toEqual(["16 work-area"]);
  });
});

describe("operationMoves", () => {
  it("splits a program's moves by operation", () => {
    const moves = operationMoves(program());
    expect([...moves.keys()]).toEqual(["Slot"]);
    expect(moves.get("Slot")?.map(({ kind, to }) => [kind, ...to])).toEqual([
      ["rapid", Number.NaN, Number.NaN, 5],
      ["rapid", 10, 10, 5],
      ["rapid", 10, 10, 1],
      ["feed", 10, 10, -2],
      ["feed", 50, 10, -2],
      ["rapid", 50, 10, 5],
      ["rapid", 50, 10, 5],
      ["rapid", 0, 0, 5],
    ]);
  });
});

describe("parseGcode", () => {
  it("reads words and comments", () => {
    expect(parseGcode("G0 X-1.5 (up) Z2\n")).toEqual([
      {
        number: 1,
        text: "G0 X-1.5 (up) Z2",
        words: [
          { letter: "G", value: 0 },
          { letter: "X", value: -1.5 },
          { letter: "Z", value: 2 },
        ],
        comment: "up",
      },
    ]);
  });
});
