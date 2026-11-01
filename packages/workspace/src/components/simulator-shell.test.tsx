// @vitest-environment jsdom
import { createProjectDocument } from "@furrow/document";
import { fullDocument } from "@furrow/document/fixtures";
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createMemoryHost } from "../lib/memory-host";
import { renderWorkspace } from "../test-render";
import { SimulatorShell } from "./simulator-shell";

vi.mock("./viewport/simulator-viewport", () => ({ SimulatorViewport: () => null }));

const exportButton = () => screen.getByRole("button", { name: "Export G-code" });

describe("SimulatorShell", () => {
  it("exports G-code from the top bar", () => {
    renderWorkspace(<SimulatorShell />, createMemoryHost({ document: fullDocument() }));
    expect((exportButton() as HTMLButtonElement).disabled).toBe(false);
  });

  it("disables the export for the same reasons as the workspace", () => {
    const { unmount } = renderWorkspace(
      <SimulatorShell />,
      createMemoryHost({ document: createProjectDocument() }),
    );
    expect(exportButton().parentElement?.title).toBe(
      "Choose a machine in the project properties first",
    );
    unmount();
    renderWorkspace(
      <SimulatorShell />,
      createMemoryHost({ document: { ...fullDocument(), operations: [] } }),
    );
    expect(exportButton().parentElement?.title).toBe("Add or enable an operation first");
  });

  it("asks guests for an account", () => {
    const prompt = vi.fn();
    renderWorkspace(
      <SimulatorShell />,
      createMemoryHost({ document: fullDocument() }, { account: { prompt } }),
    );
    fireEvent.click(exportButton());
    expect(prompt).toHaveBeenCalledWith("export-gcode");
  });
});
