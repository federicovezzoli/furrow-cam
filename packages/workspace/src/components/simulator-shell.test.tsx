// @vitest-environment jsdom
import { createProjectDocument } from "@furrow/document";
import { fullDocument } from "@furrow/document/fixtures";
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createMemoryHost } from "../lib/memory-host";
import { renderWorkspace } from "../test-render";
import { SimulatorShell } from "./simulator-shell";

vi.mock("./viewport/simulator-viewport", () => ({
  SimulatorViewport: ({ children }: { children: React.ReactNode }) => children,
}));

// Behind the lazy, browser-only viewport, so it shows up after a render.
const exportButton = () => screen.findByRole("button", { name: "Export G-code" });

describe("SimulatorShell", () => {
  it("exports G-code from the timeline", async () => {
    renderWorkspace(<SimulatorShell />, createMemoryHost({ document: fullDocument() }));
    expect(((await exportButton()) as HTMLButtonElement).disabled).toBe(false);
  });

  it("disables the export for the same reasons as the workspace", async () => {
    const { unmount } = renderWorkspace(
      <SimulatorShell />,
      createMemoryHost({ document: createProjectDocument() }),
    );
    expect((await exportButton()).parentElement?.title).toBe(
      "Choose a machine in the project properties first",
    );
    unmount();
    renderWorkspace(
      <SimulatorShell />,
      createMemoryHost({ document: { ...fullDocument(), operations: [] } }),
    );
    expect((await exportButton()).parentElement?.title).toBe("Add or enable an operation first");
  });

  it("asks guests for an account", async () => {
    const prompt = vi.fn();
    renderWorkspace(
      <SimulatorShell />,
      createMemoryHost({ document: fullDocument() }, { account: { prompt } }),
    );
    fireEvent.click(await exportButton());
    expect(prompt).toHaveBeenCalledWith("export-gcode");
  });
});
