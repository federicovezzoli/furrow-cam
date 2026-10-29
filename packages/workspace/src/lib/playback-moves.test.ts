import type { ToolpathLines } from "@furrow/cam-core";
import type { Operation } from "@furrow/document";
import { endMill, vBit } from "@furrow/document/fixtures";
import { describe, expect, it } from "vitest";
import type { ToolpathEntry } from "../stores/toolpath-store";
import { orderedSegments, partProgress, playbackMoves } from "./playback-moves";

/** A rapid down to (0, 0, -1), a feed to (`x`, 0, -1) and a rapid up. */
function lines(x: number): ToolpathLines {
  return {
    feeds: new Float32Array([0, 0, -1, x, 0, -1]),
    rapids: new Float32Array([0, 0, 5, 0, 0, -1, x, 0, -1, x, 0, 5]),
    rapidDistances: new Float32Array([0, 6, 0, 6]),
    holes: new Float32Array(),
    feedColors: new Float32Array(),
    kinds: new Uint8Array([1, 0, 1]),
  };
}

const profile: Operation = {
  id: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
  type: "drill",
  name: "Holes",
  enabled: true,
  stockSide: "top",
  targets: [],
  tool: endMill,
  params: { depth: 1, peck: false, stepOver: 40, pins: false },
};
const vcarve: Operation = {
  id: "0d9c8b7a-6f5e-4d3c-ab1a-0f9e8d7c6b5a",
  type: "vcarve",
  name: "Sign",
  enabled: true,
  stockSide: "top",
  targets: [],
  tool: vBit,
  params: { maxDepth: 3, flatBottom: { tool: endMill, stepOver: 40 } },
};

const ready = (x: number, extra: Partial<ToolpathEntry> = {}): ToolpathEntry =>
  ({
    status: "ready",
    inputHash: `h${x}`,
    warnings: [],
    lines: lines(x),
    ...extra,
  }) as ToolpathEntry;

describe("orderedSegments", () => {
  it("puts feeds and rapids back in the order the tool makes them", () => {
    expect([...orderedSegments(lines(10))]).toEqual([
      0, 0, 5, 0, 0, -1, 0, 0, -1, 10, 0, -1, 10, 0, -1, 10, 0, 5,
    ]);
  });
});

describe("playbackMoves", () => {
  it("plays the operations in order, clearing moves first, numbering the moves across them", () => {
    const moves = playbackMoves([profile, vcarve], {
      [profile.id]: ready(10),
      [vcarve.id]: ready(20, { clearing: lines(30) }),
    });
    expect(
      moves?.parts.map(({ name, clearing, firstMove, moves }) => ({
        name,
        clearing,
        firstMove,
        moves,
      })),
    ).toEqual([
      { name: "Holes", clearing: false, firstMove: 0, moves: 3 },
      { name: "Sign, clearing", clearing: true, firstMove: 3, moves: 3 },
      { name: "Sign", clearing: false, firstMove: 6, moves: 3 },
    ]);
    expect(moves?.cuts.map((cut) => cut.tool.type)).toEqual([
      "flat_end_mill",
      "flat_end_mill",
      "v_bit",
    ]);
  });

  it("waits for toolpaths still computing and leaves out failed and disabled ones", () => {
    const operations = [profile, { ...vcarve, enabled: false }];
    expect(
      playbackMoves(operations, { [profile.id]: { status: "computing", inputHash: "h" } }),
    ).toBeNull();
    const failed = playbackMoves(operations, {
      [profile.id]: { status: "error", inputHash: "h", error: "No" },
    });
    expect(failed?.parts).toEqual([]);
  });

  it("changes its key exactly when the toolpaths do", () => {
    const operations = [profile];
    const a = playbackMoves(operations, { [profile.id]: ready(10) });
    const b = playbackMoves(operations, { [profile.id]: ready(10) });
    const c = playbackMoves(operations, { [profile.id]: ready(11) });
    expect(a?.key).toBe(b?.key);
    expect(a?.key).not.toBe(c?.key);
  });

  describe("per side", () => {
    const flipped: Operation = { ...vcarve, stockSide: "bottom" };
    const operations = [profile, flipped];
    const entries = { [profile.id]: ready(10), [flipped.id]: ready(20, { clearing: lines(30) }) };

    it("plays the top side alone, without waiting for the bottom side's", () => {
      const top = playbackMoves(
        operations,
        { ...entries, [flipped.id]: { status: "computing", inputHash: "h" } },
        "top",
        "x",
      );
      expect(top?.side).toBe("top");
      expect(top?.parts.map((part) => part.name)).toEqual(["Holes"]);
      expect(top?.before).toBeUndefined();
    });

    it("plays the bottom side after the top side's cuts, turned over", () => {
      const bottom = playbackMoves(operations, entries, "bottom", "x");
      expect(bottom?.side).toBe("bottom");
      expect(bottom?.parts.map((part) => part.name)).toEqual(["Sign, clearing", "Sign"]);
      expect(bottom?.cuts).toHaveLength(2);
      expect(bottom?.before?.cuts.map((cut) => cut.tool.type)).toEqual(["flat_end_mill"]);
      expect(bottom?.before?.axis).toBe("x");
      expect(bottom?.key).not.toBe(playbackMoves(operations, entries, "top", "x")?.key);
      expect(bottom?.key).not.toBe(playbackMoves(operations, entries, "bottom", "y")?.key);
      const edited = playbackMoves(
        operations,
        { ...entries, [profile.id]: ready(11) },
        "bottom",
        "x",
      );
      expect(edited?.key).not.toBe(bottom?.key);
      expect(edited?.before?.key).not.toBe(bottom?.before?.key);
    });

    it("plays the top side of a project that isn't two-sided", () => {
      expect(playbackMoves(operations, entries, "bottom")?.side).toBe("top");
    });
  });
});

describe("partProgress", () => {
  const part = {
    operationId: profile.id,
    name: "Holes",
    clearing: false,
    color: endMill.color,
    lines: lines(10),
    firstMove: 3,
    moves: 3,
    rapidsBefore: new Uint32Array([0, 1, 1, 2]),
  };

  it("counts the feeds and rapids done", () => {
    expect(partProgress(part, 0)).toEqual({ feeds: 0, rapids: 0 });
    expect(partProgress(part, 4)).toEqual({ feeds: 0, rapids: 1 });
    expect(partProgress(part, 5)).toEqual({ feeds: 1, rapids: 1 });
    expect(partProgress(part, 100)).toEqual({ feeds: 1, rapids: 2 });
  });
});
