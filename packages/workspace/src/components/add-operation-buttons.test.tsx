// @vitest-environment jsdom
import { endMill, fullDocument, SQUARE_ID } from "@furrow/document/fixtures";
import { act, fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createMemoryHost } from "../lib/memory-host";
import { useDocumentStoreApi, useWorkspaceStoreApi } from "../providers/workspace-stores";
import type { DocumentStore } from "../stores/document-store";
import type { WorkspaceStore } from "../stores/workspace-store";
import { renderWorkspace } from "../test-render";
import { AddOperationButtons } from "./add-operation-buttons";
import { ToolLibraryProvider } from "./tool-library";

// The tooltip measures itself, which jsdom can't.
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

let stores: { document: DocumentStore; workspace: WorkspaceStore };

function Stores() {
  stores = { document: useDocumentStoreApi(), workspace: useWorkspaceStoreApi() };
  return null;
}

function render() {
  renderWorkspace(
    <>
      <Stores />
      <ToolLibraryProvider tools={[{ id: "end-mill", isDefault: true, tool: endMill }]}>
        <AddOperationButtons />
      </ToolLibraryProvider>
    </>,
    createMemoryHost({ document: { ...fullDocument(), operations: [] } }),
  );
}

describe("AddOperationButtons", () => {
  it("stays focusable while nothing is selected, and says why it can't add", async () => {
    render();
    const profile = screen.getByRole("button", { name: "Add Profile" });
    expect(profile.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(profile);
    expect(stores.document.getState().document.operations).toHaveLength(0);
    act(() => profile.focus());
    expect((await screen.findByRole("tooltip")).textContent).toBe(
      "Select paths in the viewport first",
    );
  });

  it("adds an operation for the selected paths and selects it", () => {
    render();
    act(() => stores.workspace.getState().selectPaths([{ shapeId: SQUARE_ID, path: 0 }]));
    const profile = screen.getByRole("button", { name: "Add Profile" });
    expect(profile.getAttribute("aria-disabled")).toBeNull();
    fireEvent.click(profile);
    const [operation] = stores.document.getState().document.operations;
    expect(operation?.type).toBe("profile");
    expect(stores.workspace.getState().selectedOperationId).toBe(operation?.id);
  });
});
