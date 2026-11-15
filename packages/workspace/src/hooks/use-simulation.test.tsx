// @vitest-environment jsdom
import { act } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useToolpathStoreApi } from "../providers/workspace-stores";
import type { ToolpathStore } from "../stores/toolpath-store";
import { renderWorkspace } from "../test-render";
import { useSimulation } from "./use-simulation";

let renders = 0;
let store: ToolpathStore | undefined;

function Probe() {
  renders++;
  store = useToolpathStoreApi();
  useSimulation(null);
  return null;
}

describe("useSimulation", () => {
  it("doesn't re-render on progress reports", () => {
    renderWorkspace(<Probe />);
    act(() => store?.getState().startComputing("op", "hash"));
    const before = renders;
    act(() => {
      store?.getState().setProgress("op", "hash", 0.25);
      store?.getState().setProgress("op", "hash", 0.5);
    });
    expect(renders).toBe(before);
    act(() => store?.getState().setError("op", "hash", "failed"));
    expect(renders).toBeGreaterThan(before);
  });
});
