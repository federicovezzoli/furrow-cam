import type { Toolpath, ToolpathLines } from "@furrow/cam-core";
import { describe, expect, it } from "vitest";
import { createToolpathStore } from "./toolpath-store";

const stale: Toolpath = { moves: [], warnings: ["stale"] };
const fresh: Toolpath = { moves: [], warnings: [] };
const lines: ToolpathLines = {
  feeds: new Float32Array([0, 0, 0, 1, 0, 0]),
  rapids: new Float32Array(),
  plunges: new Float32Array(),
};

describe("toolpath store", () => {
  it("keeps the result for the latest inputs only", () => {
    const store = createToolpathStore();
    store.getState().startComputing("op", "hash-1");
    store.getState().startComputing("op", "hash-2");
    store.getState().setResult("op", "hash-1", stale, lines);
    expect(store.getState().entries.op).toEqual({ inputHash: "hash-2", status: "computing" });

    store.getState().setResult("op", "hash-2", fresh, lines);
    expect(store.getState().entries.op).toEqual({
      inputHash: "hash-2",
      status: "ready",
      result: fresh,
      lines,
    });
  });

  it("keeps the last lines while recomputing, but not after an error", () => {
    const store = createToolpathStore();
    store.getState().startComputing("op", "1");
    store.getState().setResult("op", "1", fresh, lines);
    store.getState().startComputing("op", "2");
    expect(store.getState().entries.op).toEqual({ inputHash: "2", status: "computing", lines });

    store.getState().setError("op", "2", "boom");
    store.getState().startComputing("op", "3");
    expect(store.getState().entries.op).toEqual({ inputHash: "3", status: "computing" });
  });

  it("drops errors and results of operations it isn't computing", () => {
    const store = createToolpathStore();
    store.getState().setError("op", "hash", "boom");
    store.getState().setResult("op", "hash", fresh, lines);
    expect(store.getState().entries).toEqual({});
  });

  it("retains only the given operations", () => {
    const store = createToolpathStore();
    store.getState().startComputing("a", "1");
    store.getState().startComputing("b", "2");
    store.getState().retain(["b", "c"]);
    expect(Object.keys(store.getState().entries)).toEqual(["b"]);
  });
});
