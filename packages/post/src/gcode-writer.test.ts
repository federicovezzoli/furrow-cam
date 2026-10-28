import { describe, expect, it } from "vitest";
import { comment, GcodeWriter } from "./gcode-writer";

function lines(out: GcodeWriter): string[] {
  return out.toString().trimEnd().split("\n");
}

describe("comment", () => {
  it("keeps parentheses and control characters out of the comment", () => {
    expect(comment("Sign (v2)\nfinal")).toBe("(Sign [v2] final)");
    expect(comment("a\t\r\nb\u007fc")).toBe("(a b c)");
  });
});

describe("GcodeWriter", () => {
  it("moves from stock to work coordinates, except for rapidWork", () => {
    const out = new GcodeWriter([-150, -100, -18]);
    out.rapid({ x: 0, y: 0, z: 23 });
    out.feed({ x: 10, y: 20, z: 17 }, 500);
    out.rapidWork({ x: 0, y: 0 });
    expect(lines(out)).toEqual(["G0 X-150 Y-100 Z5", "G1 X-140 Y-80 Z-1 F500", "G0 X0 Y0"]);
  });

  it("writes only the words that change, and skips a move that goes nowhere", () => {
    const out = new GcodeWriter([0, 0, 0]);
    out.feed({ x: 1, y: 2, z: -1 }, 500);
    out.feed({ x: 3, y: 2, z: -1 }, 500);
    out.feed({ x: 3.0001, y: 2, z: -1 }, 800);
    out.feed({ x: 3, y: 4, z: -1 }, 800);
    expect(lines(out)).toEqual(["G1 X1 Y2 Z-1 F500", "G1 X3", "G1 Y4 F800"]);
  });

  it("writes every word again after forget", () => {
    const out = new GcodeWriter([0, 0, 0]);
    out.feed({ x: 1, y: 2, z: -1 }, 500);
    out.forget();
    out.feed({ x: 1, y: 2, z: -1 }, 500);
    expect(lines(out)).toEqual(["G1 X1 Y2 Z-1 F500", "G1 X1 Y2 Z-1 F500"]);
  });

  it("copies a custom block line by line, records where it went and forgets", () => {
    const out = new GcodeWriter([0, 0, 0]);
    out.comment("Start");
    out.rapid({ z: 5 });
    out.custom("toolChange", "G91 G0 Z10\r\nM0\r\n");
    out.rapid({ z: 5 });
    expect(lines(out)).toEqual(["(Start)", "G0 Z5", "G91 G0 Z10", "M0", "G0 Z5"]);
    expect(out.customBlocks).toEqual([{ label: "toolChange", first: 3, last: 4 }]);
  });

  it("ends the program with a newline", () => {
    const out = new GcodeWriter([0, 0, 0]);
    out.line("M30");
    expect(out.toString()).toBe("M30\n");
  });
});
