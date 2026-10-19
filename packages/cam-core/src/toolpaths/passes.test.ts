import { describe, expect, it } from "vitest";
import { Track } from "./passes";

describe("Track", () => {
  const open = new Track([
    [0, 0],
    [10, 0],
    [10, 5],
  ]);
  const closed = new Track([
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
    [0, 0],
  ]);

  it("ends an open track on its last point", () => {
    expect(open.pointAt(15)).toEqual([10, 5]);
    expect([...open.walk(0, 15)].at(-1)).toEqual([[10, 5], 15]);
    expect([...open.walk(12, 3)]).toEqual([[[10, 5], 3]]);
  });

  it("wraps around a closed track", () => {
    expect(closed.pointAt(40)).toEqual([0, 0]);
    expect(closed.pointAt(45)).toEqual([5, 0]);
    expect(closed.pointAt(-5)).toEqual([0, 5]);
    expect([...closed.walk(35, 10)].map(([point]) => point)).toEqual([
      [0, 0],
      [5, 0],
    ]);
  });
});
