// @vitest-environment jsdom
import { createProjectDocument } from "@furrow/document";
import { fullDocument, model } from "@furrow/document/fixtures";
import { act, fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createMemoryHost } from "../lib/memory-host";
import { useDocumentStoreApi, useWorkspaceStoreApi } from "../providers/workspace-stores";
import type { DocumentStore } from "../stores/document-store";
import { fitModelToStock } from "../stores/model-actions";
import type { WorkspaceStore } from "../stores/workspace-store";
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

describe("GeometryImport in an empty project", () => {
  it("shows nothing over the viewport: imports start from the ribbon (#595)", () => {
    const { container } = renderWorkspace(<GeometryImport />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(container.textContent).toBe("");
  });
});

let stores: { document: DocumentStore; workspace: WorkspaceStore };

function Stores() {
  stores = { document: useDocumentStoreApi(), workspace: useWorkspaceStoreApi() };
  return null;
}

describe("GeometryImport's STL size warning (#676)", () => {
  it("shows while the model is at its file size, and goes once it is fitted", () => {
    renderWorkspace(
      <>
        <Stores />
        <GeometryImport />
      </>,
      createMemoryHost({ document: { ...createProjectDocument(), models: [model] } }),
    );
    const message = { code: "stl.small", values: { size: 3.94, inches: 100, metres: 3940 } };
    act(() =>
      stores.workspace.getState().setModelImport({
        fileName: "emblem.stl",
        error: null,
        warning: { message, modelId: model.id },
      }),
    );
    expect(screen.getByRole("status").textContent).toContain("only 3.94 mm across");
    act(() => fitModelToStock(stores.document, model.id));
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("ModelImportButton in the ribbon", () => {
  const limits = { meshes: { maxBytes: 50_000_000, maxTriangles: 2_000_000 }, fonts: null };

  it("opens the model file input in a project holding drawings", () => {
    const click = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    renderWorkspace(
      <ModelImportButton />,
      createMemoryHost({ document: fullDocument() }, { limits }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Import a model" }));
    expect(click).toHaveBeenCalledOnce();
    click.mockRestore();
  });

  it("imports another model into a project that has one (#596)", () => {
    const click = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    renderWorkspace(
      <ModelImportButton />,
      createMemoryHost({ document: { ...createProjectDocument(), models: [model] } }, { limits }),
    );
    const button = screen.getByRole("button", { name: "Import a model" });
    expect(button.getAttribute("aria-disabled")).not.toBe("true");
    fireEvent.click(button);
    expect(click).toHaveBeenCalled();
    click.mockRestore();
  });
});
