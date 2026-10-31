import { generateToolpath, toolpathInputs, toolpathKey } from "@furrow/cam-core";
import type { ProjectDocument } from "@furrow/document";
import { fullDocument } from "@furrow/document/fixtures";
import { exportGcode } from "@furrow/post";
import { describe, expect, it, vi } from "vitest";
import { type ExportInput, exportFromResults, ToolpathResults } from "./toolpath-export";

/** The fixture project zeroed on the stock top, its enabled operations' inputs hashed by index. */
function project(): { document: ProjectDocument; inputs: ExportInput[] } {
  const document = fullDocument();
  const enabled = document.operations.filter((operation) => operation.enabled);
  const inputs = toolpathInputs(document, enabled).map((input, i) => ({
    operationId: input.operation.id,
    inputHash: `hash-${i}`,
    input,
  }));
  return { document, inputs };
}

describe("exportFromResults", () => {
  it("posts the toolpaths already computed, computing none again", () => {
    const { document, inputs } = project();
    const results = new ToolpathResults();
    for (const { operationId, inputHash, input } of inputs) {
      results.keep(operationId, inputHash, toolpathKey(input), generateToolpath(input));
    }
    const compute = vi.fn(generateToolpath);
    const exported = exportFromResults(document, "Plate", inputs, results, compute);
    expect(compute).not.toHaveBeenCalled();
    expect(exported).toEqual(exportGcode(document, "Plate"));
  });

  it("computes an operation changed since its toolpath, never posting a stale one", () => {
    const { document, inputs } = project();
    const results = new ToolpathResults();
    const [first, ...others] = inputs as [ExportInput, ...ExportInput[]];
    // The first operation's toolpath is from older inputs; the others are missing.
    results.keep(first.operationId, "older", "older", {
      moves: [],
      warnings: [{ code: "toolpath.noArea" }],
    });
    const compute = vi.fn(generateToolpath);
    const exported = exportFromResults(document, "Plate", inputs, results, compute);
    expect(compute).toHaveBeenCalledTimes(inputs.length);
    expect(exported).toEqual(exportGcode(document, "Plate"));
    // Kept for the next export.
    expect(results.get(first.operationId, first.inputHash)).toBeDefined();
    for (const { operationId, inputHash } of others) {
      expect(results.get(operationId, inputHash)).toBeDefined();
    }
  });
});

describe("ToolpathResults", () => {
  it("keeps nothing of an operation left out of the last retain", () => {
    const results = new ToolpathResults();
    const toolpath = { moves: [], warnings: [] };
    results.retain(["a"]);
    // E.g. an export queued before "b" was deleted computes it.
    results.keep("b", "1", "", toolpath);
    results.keep("a", "1", "", toolpath);
    expect(results.size).toBe(1);
    expect(results.get("b", "1")).toBeUndefined();
  });

  it("keeps one toolpath per operation, and only those retained", () => {
    const results = new ToolpathResults();
    const toolpath = { moves: [], warnings: [] };
    results.keep("a", "1", "", toolpath);
    results.keep("a", "2", "", toolpath);
    results.keep("b", "1", "", toolpath);
    expect(results.size).toBe(2);
    expect(results.get("a", "1")).toBeUndefined();
    expect(results.get("a", "2")).toBe(toolpath);
    results.retain(["b"]);
    expect(results.size).toBe(1);
    expect(results.computed("b", "")).toBe(toolpath);
    expect(results.get("a", "2")).toBeUndefined();
  });
});
