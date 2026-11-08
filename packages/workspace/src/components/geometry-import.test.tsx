// @vitest-environment jsdom
import { createProjectDocument } from "@furrow/document";
import { fullDocument, model } from "@furrow/document/fixtures";
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createMemoryHost } from "../lib/memory-host";
import { renderWorkspace } from "../test-render";
import { GeometryImport, ImportDrawingButton } from "./geometry-import";
import { ModelImportButton } from "./model-import-button";

const DRAWING_ID = "7c1e2d3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f";

describe("ImportDrawingButton", () => {
  it("opens the drawing file input once the project holds drawings", () => {
    const host = createMemoryHost({
      document: {
        ...createProjectDocument(),
        drawings: [{ id: DRAWING_ID, name: "", border: 10, rotation: 0 }],
        geometry: [
          {
            id: "4f8a1c2e-6b3d-4e5f-9a7b-8c9d0e1f2a3b",
            name: "Square",
            layer: "0",
            drawingId: DRAWING_ID,
            paths: [{ start: [0, 0], segments: [{ kind: "line", to: [10, 0] }], closed: false }],
          },
        ],
      },
    });
    const click = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    renderWorkspace(
      <>
        <ImportDrawingButton />
        <GeometryImport />
      </>,
      host,
    );
    fireEvent.click(screen.getByRole("button", { name: "Import a drawing" }));
    expect(click).toHaveBeenCalledOnce();
    click.mockRestore();
  });

  it("opens the drawing file input in a project holding a model (ADR-0078)", () => {
    const click = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    renderWorkspace(
      <>
        <ImportDrawingButton />
        <GeometryImport />
      </>,
      createMemoryHost({ document: { ...createProjectDocument(), models: [model] } }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Import a drawing" }));
    expect(click).toHaveBeenCalledOnce();
    click.mockRestore();
  });
});

describe("ModelImportButton in the ribbon", () => {
  const limits = { meshes: { maxBytes: 50_000_000, maxTriangles: 2_000_000 }, fonts: null };

  it("opens the model file input in a project holding drawings", () => {
    const click = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    renderWorkspace(
      <ModelImportButton inRibbon />,
      createMemoryHost({ document: fullDocument() }, { limits }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Import a model" }));
    expect(click).toHaveBeenCalledOnce();
    click.mockRestore();
  });

  it("is disabled once the project has its one model", () => {
    const click = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    renderWorkspace(
      <ModelImportButton inRibbon />,
      createMemoryHost({ document: { ...createProjectDocument(), models: [model] } }, { limits }),
    );
    const button = screen.getByRole("button", { name: "Import a model" });
    expect(button.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(button);
    expect(click).not.toHaveBeenCalled();
    click.mockRestore();
  });
});
