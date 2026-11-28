import type { ToolpathLines } from "@furrow/cam-core";
import type { Operation } from "@furrow/document";
import { endMill, vBit } from "@furrow/document/fixtures";
import { describe, expect, it } from "vitest";
import type { ToolpathEntry } from "../stores/toolpath-store";
import {
  firstMoveOfLine,
  partAt,
  partProgress,
  playbackKey,
  playedProgram,
  programParts,
} from "./playback-moves";

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
  params: { depth: 1, peck: false, stepOver: 40, pins: false, points: [] },
};
const vcarve: Operation = {
  id: "0d9c8b7a-6f5e-4d3c-ab1a-0f9e8d7c6b5a",
  type: "vcarve",
  name: "Sign",
  enabled: true,
  stockSide: "top",
  targets: [],
  tool: vBit,
  params: { startDepth: 0, maxDepth: 3, flatBottom: { tool: endMill, stepOver: 40 } },
};

const ready = (x: number, extra: Partial<ToolpathEntry> = {}): ToolpathEntry =>
  ({
    status: "ready",
    inputHash: `h${x}`,
    warnings: [],
    lines: lines(x),
    ...extra,
  }) as ToolpathEntry;

describe("playbackKey", () => {
  it("waits for toolpaths still computing and leaves out failed and disabled ones", () => {
    const operations = [profile, { ...vcarve, enabled: false }];
    expect(
      playbackKey(operations, { [profile.id]: { status: "computing", inputHash: "h" } }),
    ).toBeNull();
    const failed = playbackKey(operations, {
      [profile.id]: { status: "error", inputHash: "h", error: "No" },
    });
    expect(failed?.key).not.toBe(playbackKey(operations, { [profile.id]: ready(10) })?.key);
  });

  it("changes exactly when the toolpaths or what the post writes do", () => {
    const operations = [profile];
    const a = playbackKey(operations, { [profile.id]: ready(10) }, "top", null, ["m"]);
    expect(playbackKey(operations, { [profile.id]: ready(10) }, "top", null, ["m"])?.key).toBe(
      a?.key,
    );
    expect(playbackKey(operations, { [profile.id]: ready(11) }, "top", null, ["m"])?.key).not.toBe(
      a?.key,
    );
    expect(playbackKey(operations, { [profile.id]: ready(10) }, "top", null, ["n"])?.key).not.toBe(
      a?.key,
    );
  });

  describe("per side", () => {
    const flipped: Operation = { ...vcarve, stockSide: "bottom" };
    const operations = [profile, flipped];
    const entries = { [profile.id]: ready(10), [flipped.id]: ready(20) };

    it("plays the top side alone, without waiting for the bottom side's", () => {
      const top = playbackKey(
        operations,
        { ...entries, [flipped.id]: { status: "computing", inputHash: "h" } },
        "top",
        "x",
      );
      expect(top?.side).toBe("top");
      expect(top?.before).toBeUndefined();
    });

    it("plays the bottom side after the top side's program", () => {
      const bottom = playbackKey(operations, entries, "bottom", "x");
      const top = playbackKey(operations, entries, "top", "x");
      expect(bottom?.side).toBe("bottom");
      expect(bottom?.before).toBe(top?.key);
      expect(bottom?.key).not.toBe(top?.key);
      expect(bottom?.key).not.toBe(playbackKey(operations, entries, "bottom", "y")?.key);
    });

    it("plays the top side of a project that isn't two-sided", () => {
      expect(playbackKey(operations, entries, "bottom")?.side).toBe("top");
    });
  });
});

describe("programParts", () => {
  const entries = {
    [profile.id]: ready(10),
    [vcarve.id]: ready(20, { clearing: lines(30) }),
  };
  // Three steps over two cuts: the clearing end mill is the profile's bit, so no tool change.
  const steps = [
    {
      operationId: profile.id,
      clearing: false,
      first: 10,
      moveLines: Uint32Array.of(12, 13, 14, 15),
    },
    {
      operationId: vcarve.id,
      clearing: true,
      first: 18,
      moveLines: Uint32Array.of(21, 22, 23, 24),
    },
    // Rounding left its third move out, on the second's line.
    {
      operationId: vcarve.id,
      clearing: false,
      first: 30,
      moveLines: Uint32Array.of(32, 33, 33, 34),
    },
  ];
  const segmentLines = [
    Uint32Array.of(3, 11, 12, 13, 14, 15, 16, 19, 21, 22, 23, 24),
    Uint32Array.of(31, 32, 33, 34, 40),
  ];

  it("splits the program at each step's first line, the first from its start, the last to its end", () => {
    const parts = programParts(steps, segmentLines, [profile, vcarve], entries);
    expect(
      parts.map(({ name, clearing, color, firstMove, moves }) => ({
        name,
        clearing,
        color,
        firstMove,
        moves,
      })),
    ).toEqual([
      { name: "Holes", clearing: false, color: endMill.color, firstMove: 0, moves: 7 },
      { name: "Sign, clearing", clearing: true, color: endMill.color, firstMove: 7, moves: 5 },
      { name: "Sign", clearing: false, color: vBit.color, firstMove: 12, moves: 5 },
    ]);
    expect(partAt(parts, 9)?.name).toBe("Sign, clearing");
  });

  it("counts the toolpath's segments done as the program's are", () => {
    const [holes, clearing, sign] = programParts(steps, segmentLines, [profile, vcarve], entries);
    expect([...(holes?.done ?? [])]).toEqual([0, 0, 0, 0, 1, 2, 3, 3]);
    expect([...(clearing?.done ?? [])]).toEqual([0, 0, 0, 1, 2, 3]);
    expect([...(sign?.done ?? [])]).toEqual([0, 0, 0, 2, 3, 3]);
    expect([...(sign?.rapidsBefore ?? [])]).toEqual([0, 1, 1, 2]);
  });

  it("gives a step whose toolpath isn't ready to the part before", () => {
    const parts = programParts(steps, segmentLines, [profile, vcarve], {
      [profile.id]: ready(10),
      [vcarve.id]: { status: "computing", inputHash: "h" },
    });
    expect(parts.map(({ name, moves }) => [name, moves])).toEqual([["Holes", 17]]);
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
    moves: 4,
    done: Uint32Array.of(0, 0, 1, 2, 3),
    rapidsBefore: new Uint32Array([0, 1, 1, 2]),
  };

  it("counts the feeds and rapids done", () => {
    expect(partProgress(part, 0)).toEqual({ feeds: 0, rapids: 0 });
    expect(partProgress(part, 4)).toEqual({ feeds: 0, rapids: 0 });
    expect(partProgress(part, 5)).toEqual({ feeds: 0, rapids: 1 });
    expect(partProgress(part, 6)).toEqual({ feeds: 1, rapids: 1 });
    expect(partProgress(part, 100)).toEqual({ feeds: 1, rapids: 2 });
  });
});

describe("firstMoveOfLine", () => {
  // Line 2 sets the position without moving, line 3 has a still move then a 5 mm one.
  const moves = Uint32Array.of(2, 3, 3, 4);
  const path = { ends: Float64Array.of(0, 0, 5, 15) };

  it("seeks to the first move of a line that goes somewhere", () => {
    expect(firstMoveOfLine(moves, path, 3)).toBe(2);
    expect(firstMoveOfLine(moves, path, 4)).toBe(3);
  });

  it("finds none on a line without moves, or whose moves go nowhere", () => {
    expect(firstMoveOfLine(moves, path, 1)).toBeNull();
    expect(firstMoveOfLine(moves, path, 2)).toBeNull();
    expect(firstMoveOfLine(moves, path, 5)).toBeNull();
  });
});

describe("playedProgram", () => {
  const cut = (z: number) => ({ tool: endMill, segments: Float32Array.of(0, 0, 0, 0, 0, z) });
  const playback = (side: "top" | "bottom" | null, z: number) => ({
    side,
    steps: [],
    cuts: [cut(z)],
    lines: [Uint32Array.of(9)],
    warnings: [{ line: 9, code: "unsupported" as const, word: "A1" }],
  });
  const files = { files: [], warnings: [] };

  it("plays a one-sided project's only program", () => {
    const played = playedProgram(
      { key: "k", side: "top" },
      { ...files, playbacks: [playback(null, -1)] },
      null,
    );
    expect(played.cuts).toEqual([cut(-1)]);
    expect(played.warnings).toHaveLength(1);
    expect(played.failure).toBeNull();
    expect(played.before).toBeUndefined();
  });

  it("plays the bottom side's program after the top side's", () => {
    const file = (side: "top" | "bottom") => ({
      fileName: `${side}.gcode`,
      gcode: `(${side})`,
      side,
      steps: [],
      blocks: [{ label: "programEnd" as const, first: 1, last: 1 }],
    });
    const played = playedProgram(
      { key: "k", side: "bottom", before: "t" },
      {
        files: [file("top"), file("bottom")],
        warnings: [],
        playbacks: [playback("top", -1), playback("bottom", -2)],
      },
      "x",
    );
    expect(played.cuts).toEqual([cut(-2)]);
    // The text shown is the side played's, as Export saves it.
    expect(played.gcode).toBe("(bottom)");
    expect(played.blocks).toEqual(file("bottom").blocks);
    expect(played.before).toEqual({ key: "t", cuts: [cut(-1)], axis: "x" });
    // The top side's warnings count too: its cuts are under the bottom side's.
    expect(played.warnings).toEqual([
      { line: 9, code: "unsupported", word: "A1", side: "top" },
      { line: 9, code: "unsupported", word: "A1" },
    ]);
  });

  it("says why a program can't be played, but not that there is nothing to post", () => {
    expect(
      playedProgram({ key: "k", side: "top" }, { error: { code: "export.noEnabled" } }, null)
        .failure,
    ).toBeNull();
    expect(
      playedProgram({ key: "k", side: "top" }, { error: "Broken", operation: "Holes" }, null)
        .failure,
    ).toEqual({ error: "Broken", operation: "Holes" });
    const unread = {
      side: "top" as const,
      steps: [],
      error: { line: 4, reason: "badArc" as const },
    };
    const played = playedProgram(
      { key: "k", side: "bottom", before: "t" },
      { ...files, playbacks: [unread, playback("bottom", -2)] },
      "x",
    );
    // Its line is in the top side's program, not the one shown.
    expect(played.failure).toEqual({ line: 4, reason: "badArc", side: "top" });
    expect(played.before?.cuts).toEqual([]);
    expect(played.cuts).toEqual([cut(-2)]);
  });
});
