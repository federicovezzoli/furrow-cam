// @vitest-environment jsdom
import { createProjectDocument } from "@furrow/document";
import {
  RELIEF_FINISH_ID,
  RELIEF_ROUGH_ID,
  reliefFinish,
  reliefRough,
} from "@furrow/document/fixtures";
import { act, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createMemoryHost } from "../lib/memory-host";
import { useToolpathStoreApi } from "../providers/workspace-stores";
import type { ToolpathStore } from "../stores/toolpath-store";
import { renderWorkspace } from "../test-render";
import { OperationsPane } from "./operations-pane";

const lines = {} as never;

/** The toolpath store of the render, for the test to fill. */
let toolpaths: ToolpathStore | undefined;
function Toolpaths() {
  toolpaths = useToolpathStoreApi();
  return null;
}

describe("OperationsPane", () => {
  it("shows each toolpath's time and the total of the enabled operations", () => {
    const document = {
      ...createProjectDocument(),
      operations: [reliefFinish, { ...reliefRough, enabled: false }],
    };
    renderWorkspace(
      <>
        <OperationsPane />
        <Toolpaths />
      </>,
      createMemoryHost({ document }),
    );
    act(() => {
      for (const [id, seconds] of [
        [RELIEF_FINISH_ID, 725],
        [RELIEF_ROUGH_ID, 3600],
      ] as const) {
        toolpaths?.getState().startComputing(id, "h");
        toolpaths?.getState().setResult(id, "h", { warnings: [], lines, seconds });
      }
    });
    expect(screen.getByTitle("Estimated machining time").textContent).toBe("≈ 12 min");
    expect(screen.getByText("Total ≈ 12 min")).toBeTruthy();
    // The project has no machine.
    expect(screen.getByText(/rapids aren't counted/)).toBeTruthy();
  });
});
