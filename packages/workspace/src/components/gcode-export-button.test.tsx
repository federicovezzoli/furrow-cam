// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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

describe("GcodeExportButton", () => {
  it("saves every file of the export, one per side (ADR-0060)", async () => {
    renderWorkspace(
      <>
        <TwoFiles />
        <GcodeExportButton name="Owl" />
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Export G-code" }));
    await waitFor(() => expect(download).toHaveBeenCalledTimes(2));
    expect(download.mock.calls).toEqual([
      ["(top)", "Owl-top.gcode", "text/plain"],
      ["(bottom)", "Owl-bottom.gcode", "text/plain"],
    ]);
  });
});
