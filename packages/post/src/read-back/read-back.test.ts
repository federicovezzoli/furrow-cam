import { describe, expect, it } from "vitest";
import { gcodeMoves, parseGcode } from "./read-back";

const moves = (gcode: string) =>
  gcodeMoves(parseGcode(gcode)).map(({ line, from, to }) => ({ line, from, to }));
const N = Number.NaN;

describe("gcodeMoves (#688)", () => {
  it("set the axes G10 L20 names, without moving", () => {
    expect(moves("G10 L20 P0 X0 Y0 Z0\nG0 X10")).toEqual([
      { line: 2, from: [0, 0, 0], to: [10, 0, 0] },
    ]);
  });

  it("lose the axes G10 L2 names in the work system in use, and not in another", () => {
    expect(moves("G0 X1 Y2 Z3\nG10 L2 P1 Z5\nG10 L2 P3 X5\nG0 X4")).toEqual([
      { line: 1, from: [N, N, N], to: [1, 2, 3] },
      { line: 4, from: [1, 2, N], to: [4, 2, N] },
    ]);
  });

  it("lose the axes a probe names, until a retract sets them", () => {
    expect(moves("G0 X1 Y2 Z3\nG38.2 Z-110 F200 P0.5\nG1 Z10 F900")).toEqual([
      { line: 1, from: [N, N, N], to: [1, 2, 3] },
      { line: 3, from: [1, 2, N], to: [1, 2, 10] },
    ]);
  });

  it("lose the axes $H homes, and all of them for another $ command", () => {
    expect(moves("G0 X1 Y2 Z3\n$HZ\nG0 X4\n$LocalFS/Run=park.nc\nG0 Z5")).toEqual([
      { line: 1, from: [N, N, N], to: [1, 2, 3] },
      { line: 3, from: [1, 2, N], to: [4, 2, N] },
      { line: 5, from: [N, N, N], to: [N, N, 5] },
    ]);
  });
});
