import type { Model, Operation, ProjectDocument, RoughingBoundary } from "@furrow/document";
import {
  endMill,
  fullDocument,
  model as modelFixture,
  reliefRough,
} from "@furrow/document/fixtures";
import { describe, expect, it } from "vitest";
import { generateToolpath, toolpathInputs, toolpathKey } from "../generate";
import { createCache } from "./finish";

/** A 20 × 10 × 5 block, its top face only: enough to rough. */
const mesh = new Float32Array([0, 0, 5, 20, 0, 5, 20, 10, 5, 0, 0, 5, 20, 10, 5, 0, 10, 5]);

function block(id: string, position: [number, number]): Model {
  return {
    ...modelFixture,
    id,
    bounds: { min: [0, 0, 0], max: [20, 10, 5] },
    placement: { rotation: [0, 0, 0], scale: 1, depth: 5, top: 0, position },
  };
}

const MACHINED = block("00000000-0000-4000-8000-000000000001", [20, 20]);
const REACHES = { code: "toolpath.reachesOtherModel" };

/** The input of roughing `MACHINED` within `boundary`, beside `other`. */
function input(boundary: RoughingBoundary, other: Model) {
  const params = { ...reliefRough.params, modelId: MACHINED.id, boundary };
  const operation: Operation = { ...reliefRough, tool: endMill, params };
  const doc = fullDocument();
  const document: ProjectDocument = {
    ...doc,
    stock: { ...doc.stock, width: 60, height: 50, thickness: 18, touchOff: null, twoSided: null },
    models: [MACHINED, other],
    operations: [operation],
  };
  const [first] = toolpathInputs(document);
  if (!first) throw new Error("no input");
  return first;
}

function warnings(boundary: RoughingBoundary, other: Model) {
  return generateToolpath(input(boundary, other), { mesh: () => mesh, cache: createCache(2) })
    .warnings;
}

describe("a 3D operation beside other models (#596)", () => {
  const far = block("00000000-0000-4000-8000-000000000002", [2, 2]);

  it("warns when the stock boundary reaches another model", () => {
    expect(warnings({ type: "stock" }, far)).toContainEqual(REACHES);
  });

  it("doesn't warn when the model boundary stays clear of it, or it is hidden", () => {
    expect(warnings({ type: "model" }, far)).not.toContainEqual(REACHES);
    expect(warnings({ type: "stock" }, { ...far, hidden: true })).not.toContainEqual(REACHES);
  });

  it("warns when the tool cuts past the model's outline into a model beside it", () => {
    // 1 mm above the machined block: the tool's radius past its outline reaches it.
    const near = block("00000000-0000-4000-8000-000000000003", [20, 31]);
    expect(warnings({ type: "model" }, near)).toContainEqual(REACHES);
  });

  it("recomputes nothing when another model moves but the warning stays", () => {
    const moved = { ...far, placement: { ...far.placement, position: [4, 3] as [number, number] } };
    expect(toolpathKey(input({ type: "model" }, moved))).toBe(
      toolpathKey(input({ type: "model" }, far)),
    );
  });
});
