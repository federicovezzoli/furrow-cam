// @vitest-environment jsdom

import { fullDocument } from "@furrow/document/fixtures";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createMemoryHost } from "../lib/memory-host";
import { useToolpathStoreApi } from "../providers/workspace-stores";
import { renderWorkspace } from "../test-render";
import { GcodeExportButton } from "./gcode-export-button";

const download = vi.hoisted(() => vi.fn());
vi.mock("@furrow/ui/lib/download", () => ({ downloadFile: download }));

/** Answers every export with these two files, as a two-sided project's would. */
function TwoFiles() {
  const store = useToolpathStoreApi();
  store.getState().setControls({
    cancel() {},
    retry() {},
    exportGcode: async () => ({
      files: [
        { fileName: "Owl-top.gcode", gcode: "(top)" },
        { fileName: "Owl-bottom.gcode", gcode: "(bottom)" },
      ],
      warnings: [],
    }),
  });
  return null;
}

const neverDone = vi.fn(() => new Promise<never>(() => {}));

/** Answers no export, as one still running. */
function Pending() {
  useToolpathStoreApi()
    .getState()
    .setControls({ cancel() {}, retry() {}, exportGcode: neverDone });
  return null;
}

describe("GcodeExportButton", () => {
  it("saves every file of the export, one per side (ADR-0060)", async () => {
    renderWorkspace(
      <>
        <TwoFiles />
        <GcodeExportButton />
      </>,
      createMemoryHost({ document: fullDocument(), name: "Owl" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Export G-code" }));
    await waitFor(() => expect(download).toHaveBeenCalledTimes(2));
    expect(download.mock.calls).toEqual([
      ["(top)", "Owl-top.gcode", "text/plain"],
      ["(bottom)", "Owl-bottom.gcode", "text/plain"],
    ]);
    // Said, in case the browser saved only one.
    expect(await screen.findByText(/saved as Owl-top\.gcode, Owl-bottom\.gcode/)).toBeTruthy();
  });

  it("starts no export while one started elsewhere runs, e.g. on the other page", () => {
    renderWorkspace(
      <>
        <Pending />
        <GcodeExportButton />
        <GcodeExportButton />
      </>,
      createMemoryHost({ document: fullDocument() }),
    );
    const [first, second] = screen.getAllByRole("button", { name: "Export G-code" });
    fireEvent.click(first as HTMLElement);
    expect((second as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(second as HTMLElement);
    expect(neverDone).toHaveBeenCalledTimes(1);
  });
});
