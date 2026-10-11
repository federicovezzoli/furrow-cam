import type { Toolpath } from "@furrow/cam-core";
import { describe, expect, it } from "vitest";
import { createToolpathStore } from "./toolpath-store";

const stale: Toolpath = { moves: [], warnings: ["stale"] };
const fresh: Toolpath = { moves: [], warnings: [] };

describe("toolpath store", () => {
  it("keeps the result for the latest inputs only", () => {
    const store = createToolpathStore();
    store.getState().startComputing("op", "hash-1");
    store.getState().startComputing("op", "hash-2");
    store.getState().setResult("op", "hash-1", stale);
    expect(store.getState().entries.op).toEqual({ inputHash: "hash-2", status: "computing" });

    store.getState().setResult("op", "hash-2", fresh);
    expect(store.getState().entries.op).toEqual({
      inputHash: "hash-2",
      status: "ready",
      result: fresh,
    });
  });

  it("drops errors and results of operations it isn't computing", () => {
    const store = createToolpathStore();
    store.getState().setError("op", "hash", "boom");
    store.getState().setResult("op", "hash", fresh);
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
