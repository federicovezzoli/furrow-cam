import { describe, expect, it } from "vitest";
import type { ToolpathEntry } from "../stores/toolpath-store";
import { toolpathProgress } from "./toolpath-progress";

const operations = [
  { id: "a", name: "Profile", enabled: true },
  { id: "b", name: "Pocket", enabled: true },
  { id: "c", name: "Relief", enabled: true },
  { id: "d", name: "Drill", enabled: false },
];
const computing = (progress?: number): ToolpathEntry => ({
  inputHash: "h",
  status: "computing",
  ...(progress !== undefined && { progress }),
});
const ready: ToolpathEntry = { inputHash: "h", status: "ready", warnings: [], lines: {} as never };

describe("toolpathProgress", () => {
  it("names the first operation computing, with its progress, and counts the batch", () => {
    const { batch, summary } = toolpathProgress(
      operations,
      { a: computing(), b: computing(), c: computing() },
      new Set(),
    );
    expect(summary).toEqual({ running: { id: "a", name: "Profile" }, done: 0, total: 3 });

    const next = toolpathProgress(operations, { a: ready, b: ready, c: computing(0.4) }, batch);
    expect(next.summary).toEqual({
      running: { id: "c", name: "Relief", progress: 0.4 },
      done: 2,
      total: 3,
    });
  });

  it("names the operation reporting progress, queued edits of earlier ones aside", () => {
    // A 3D operation runs while an edit of an earlier one waits in the worker's queue.
    const { summary } = toolpathProgress(
      operations,
      { a: computing(), c: computing(0.7) },
      new Set(["c"]),
    );
    expect(summary?.running).toEqual({ id: "c", name: "Relief", progress: 0.7 });
  });

  it("starts a new batch once nothing computes", () => {
    const { batch, summary } = toolpathProgress(operations, { a: ready }, new Set(["a", "b"]));
    expect(summary).toBeNull();
    expect(batch.size).toBe(0);
  });

  it("leaves out disabled and deleted operations", () => {
    const { summary } = toolpathProgress(
      operations,
      { b: computing(), d: computing() },
      new Set(["gone", "a"]),
    );
    expect(summary).toEqual({ running: { id: "b", name: "Pocket" }, done: 1, total: 2 });
  });
});
