import type { ToolpathLines } from "@furrow/cam-core";
import { describe, expect, it } from "vitest";
import {
  CANCELLED,
  createToolpathStore,
  sanitizeForDevtools,
  type ToolpathPreview,
} from "./toolpath-store";

const lines: ToolpathLines = {
  feeds: new Float32Array([0, 0, 0, 1, 0, 0]),
  rapids: new Float32Array(),
  rapidDistances: new Float32Array(),
  holes: new Float32Array(),
  feedColors: new Float32Array(),
};
const stale: ToolpathPreview = { warnings: ["stale"], lines };
const fresh: ToolpathPreview = { warnings: [], lines };

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
      ...fresh,
    });
  });

  it("keeps the last lines while recomputing, but not after an error", () => {
    const store = createToolpathStore();
    store.getState().startComputing("op", "1");
    store.getState().setResult("op", "1", fresh);
    store.getState().startComputing("op", "2");
    expect(store.getState().entries.op).toEqual({ inputHash: "2", status: "computing", lines });

    store.getState().setError("op", "2", "boom");
    store.getState().startComputing("op", "3");
    expect(store.getState().entries.op).toEqual({ inputHash: "3", status: "computing" });
  });

  it("keeps the last clearing lines while recomputing too", () => {
    const store = createToolpathStore();
    const clearing = { ...lines, feeds: new Float32Array([0, 0, -1, 2, 0, -1]) };
    store.getState().startComputing("op", "1");
    store.getState().setResult("op", "1", { ...fresh, clearing });
    store.getState().startComputing("op", "2");
    expect(store.getState().entries.op).toEqual({
      inputHash: "2",
      status: "computing",
      lines,
      clearing,
    });
  });

  it("drops errors and results of operations it isn't computing", () => {
    const store = createToolpathStore();
    store.getState().setError("op", "hash", "boom");
    store.getState().setResult("op", "hash", fresh);
    expect(store.getState().entries).toEqual({});
  });

  it("keeps the progress of the latest inputs while computing, from 0 again on a change", () => {
    const store = createToolpathStore();
    store.getState().startComputing("op", "1");
    store.getState().setProgress("op", "1", 0.5);
    store.getState().setProgress("op", "0", 0.9);
    expect(store.getState().entries.op).toEqual({
      inputHash: "1",
      status: "computing",
      progress: 0.5,
    });
    store.getState().startComputing("op", "2");
    expect(store.getState().entries.op).toEqual({ inputHash: "2", status: "computing" });
    store.getState().setResult("op", "2", fresh);
    store.getState().setProgress("op", "2", 0.9);
    expect(store.getState().entries.op?.status).toBe("ready");
  });

  it("marks cancelled toolpaths of the latest inputs", () => {
    const store = createToolpathStore();
    store.getState().startComputing("op", "1");
    store.getState().setCancelled("op", "0");
    expect(store.getState().entries.op?.status).toBe("computing");
    store.getState().setCancelled("op", "1");
    expect(store.getState().entries.op).toEqual({
      inputHash: "1",
      status: "error",
      error: CANCELLED,
      cancelled: true,
    });
  });

  it("has controls that do nothing until the scheduler sets them", () => {
    const store = createToolpathStore();
    const cancelled: string[] = [];
    store.getState().controls.cancel("op");
    store.getState().setControls({ cancel: (id) => cancelled.push(id), retry() {} });
    store.getState().controls.cancel("op");
    store.getState().setControls(null);
    store.getState().controls.cancel("op");
    expect(cancelled).toEqual(["op"]);
  });

  it("shows typed arrays to the devtools as their length", () => {
    const store = createToolpathStore();
    store.getState().startComputing("op", "1");
    store.getState().setResult("op", "1", fresh);
    expect(sanitizeForDevtools(store.getState())).toMatchObject({
      entries: { op: { status: "ready", lines: { feeds: "Float32Array(6)" } } },
    });
  });

  it("retains only the given operations", () => {
    const store = createToolpathStore();
    store.getState().startComputing("a", "1");
    store.getState().startComputing("b", "2");
    store.getState().retain(["b", "c"]);
    expect(Object.keys(store.getState().entries)).toEqual(["b"]);
  });
});
