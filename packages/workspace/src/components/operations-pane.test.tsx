// @vitest-environment jsdom
import { createProjectDocument } from "@furrow/document";
import {
  CIRCLE_ID,
  fullDocument,
  model,
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
    expect(screen.getByTitle("Estimated machining time").textContent).toBe("≈ 12min");
    expect(screen.getByText("Total ≈ 12min")).toBeTruthy();
    // The project has no machine.
    expect(screen.getByText(/rapids aren't counted/)).toBeTruthy();
  });
});

describe("OperationsPane: hidden objects (ADR-0080)", () => {
  const render = (document: ReturnType<typeof fullDocument>) =>
    renderWorkspace(<OperationsPane />, createMemoryHost({ document }));
  const checkbox = () => screen.getByLabelText("Enable Outside profile") as HTMLInputElement;

  it("turns off, without changing it, an operation whose targets are hidden", () => {
    const document = fullDocument();
    render({ ...document, drawings: document.drawings.map((d) => ({ ...d, hidden: true })) });
    expect(checkbox().checked).toBe(false);
    expect(checkbox().disabled).toBe(true);
    expect(checkbox().title).toMatch(/something it cuts is hidden/);
  });

  it("totals the other operations' time", () => {
    const document = fullDocument();
    renderWorkspace(
      <>
        <OperationsPane />
        <Toolpaths />
      </>,
      createMemoryHost({
        document: {
          ...document,
          stock: { ...document.stock, twoSided: null },
          drawings: document.drawings.map((d) => ({ ...d, hidden: true })),
          models: [model],
          operations: [...document.operations, reliefFinish],
        },
      }),
    );
    act(() => {
      toolpaths?.getState().startComputing(RELIEF_FINISH_ID, "h");
      toolpaths?.getState().setResult(RELIEF_FINISH_ID, "h", { warnings: [], lines, seconds: 725 });
    });
    expect(screen.getByText("Total ≈ 12min")).toBeTruthy();
  });

  it("turns off one with only some targets hidden too", () => {
    const document = fullDocument();
    render({
      ...document,
      geometry: document.geometry.map((s) => (s.id === CIRCLE_ID ? { ...s, hidden: true } : s)),
    });
    expect(checkbox().checked).toBe(false);
    expect(checkbox().disabled).toBe(true);
  });
});
