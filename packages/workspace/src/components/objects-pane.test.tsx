// @vitest-environment jsdom
import type { ProjectDocument } from "@furrow/document";
import {
  CIRCLE_ID,
  DRAWING_ID,
  fullDocument,
  model,
  OPERATION_ID,
  SQUARE_ID,
} from "@furrow/document/fixtures";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createMemoryHost } from "../lib/memory-host";
import { useDocumentStoreApi, useWorkspaceStoreApi } from "../providers/workspace-stores";
import type { DocumentStore } from "../stores/document-store";
import { setObjectFlag } from "../stores/geometry-actions";
import type { WorkspaceStore } from "../stores/workspace-store";
import { renderWorkspace } from "../test-render";
import { ObjectsPane, stlFileName } from "./objects-pane";

const download = vi.hoisted(() => vi.fn());
vi.mock("@furrow/ui/lib/download", () => ({ downloadFile: download }));

type Seen = { store: DocumentStore | null; workspace: WorkspaceStore | null };

function Probe({ seen }: { seen: Seen }) {
  seen.store = useDocumentStoreApi();
  seen.workspace = useWorkspaceStoreApi();
  return null;
}

/** The fixture's drawing, its square given a second path, and the model. */
function render() {
  const document = fullDocument();
  const doc: ProjectDocument = {
    ...document,
    geometry: document.geometry.map((shape) =>
      shape.id === SQUARE_ID ? { ...shape, paths: [...shape.paths, ...shape.paths] } : shape,
    ),
    models: [model],
  };
  const seen: Seen = { store: null, workspace: null };
  const host = createMemoryHost({ document: doc });
  renderWorkspace(
    <>
      <ObjectsPane />
      <Probe seen={seen} />
    </>,
    host,
  );
  return { ...(seen as { store: DocumentStore; workspace: WorkspaceStore }), host };
}

const row = (name: string) => screen.getByRole("treeitem", { name: new RegExp(`^${name}`) });
const square0 = { shapeId: SQUARE_ID, path: 0 };
const square1 = { shapeId: SQUARE_ID, path: 1 };
const circle0 = { shapeId: CIRCLE_ID, path: 0 };

describe("ObjectsPane (ADR-0080)", () => {
  it("lists drawings and the model, their shapes and paths only once expanded", () => {
    render();
    expect(screen.getAllByRole("treeitem").map((item) => item.getAttribute("aria-level"))).toEqual([
      "1",
      "1",
    ]);
    expect(row("part.dxf").getAttribute("aria-expanded")).toBe("false");
    fireEvent.keyDown(row("part.dxf"), { key: "ArrowRight" });
    expect(row("Square").getAttribute("aria-expanded")).toBe("false");
    // One path: nothing below it.
    expect(row("Hole").hasAttribute("aria-expanded")).toBe(false);
    fireEvent.keyDown(row("Square"), { key: "ArrowRight" });
    expect(row("Path 2").getAttribute("aria-level")).toBe("3");
    expect(row(model.fileName)).toBeTruthy();
  });

  it("selects what a row stands for, entering its drawing below the top level", () => {
    const { workspace } = render();
    fireEvent.click(row("part.dxf"));
    expect(workspace.getState()).toMatchObject({
      selectedPaths: [square0, square1, circle0],
      enteredDrawingId: null,
    });
    expect(row("part.dxf").getAttribute("aria-selected")).toBe("true");

    fireEvent.keyDown(row("part.dxf"), { key: "ArrowRight" });
    fireEvent.click(row("Hole"));
    expect(workspace.getState()).toMatchObject({
      selectedPaths: [circle0],
      enteredDrawingId: DRAWING_ID,
    });
    fireEvent.click(row("Square"), { shiftKey: true });
    expect(workspace.getState().selectedPaths).toEqual([circle0, square0, square1]);

    fireEvent.click(row(model.fileName));
    expect(workspace.getState().selectedModelId).toBe(model.id);
  });

  it("enters no drawing while the viewport doesn't take clicks", () => {
    const { workspace } = render();
    fireEvent.keyDown(row("part.dxf"), { key: "ArrowRight" });
    act(() => workspace.getState().setPickingZero(true));
    fireEvent.click(row("Hole"));
    expect(workspace.getState()).toMatchObject({
      selectedPaths: [circle0],
      enteredDrawingId: null,
    });
  });

  it("moves with the arrows and selects with Enter", () => {
    const { workspace } = render();
    const first = row("part.dxf");
    act(() => first.focus());
    fireEvent.keyDown(first, { key: "ArrowDown" });
    expect(document.activeElement).toBe(row(model.fileName));
    fireEvent.keyDown(row(model.fileName), { key: "Enter" });
    expect(workspace.getState().selectedModelId).toBe(model.id);
    fireEvent.keyDown(row(model.fileName), { key: "ArrowUp" });
    fireEvent.keyDown(row("part.dxf"), { key: "ArrowRight" });
    fireEvent.keyDown(row("part.dxf"), { key: "ArrowRight" });
    expect(document.activeElement).toBe(row("Square"));
    fireEvent.keyDown(row("Square"), { key: "ArrowLeft" });
    expect(document.activeElement).toBe(row("part.dxf"));
  });

  it("hides and locks with the eye and the lock, and doesn't select what is hidden", () => {
    const { store, workspace } = render();
    const drawing = row("part.dxf");
    fireEvent.click(within(drawing).getByRole("button", { name: "Lock part.dxf" }));
    expect(store.getState().document.drawings[0]?.locked).toBe(true);
    // Locked objects stay selectable from the tree.
    fireEvent.click(row("part.dxf"));
    expect(workspace.getState().selectedPaths).toEqual([square0, square1, circle0]);

    fireEvent.click(within(drawing).getByRole("button", { name: "Hide part.dxf" }));
    expect(store.getState().document.drawings[0]?.hidden).toBe(true);
    expect(row("part.dxf").getAttribute("aria-disabled")).toBe("true");
    act(() => workspace.getState().selectPaths([]));
    fireEvent.click(row("part.dxf"));
    expect(workspace.getState().selectedPaths).toEqual([]);
    fireEvent.click(within(row("part.dxf")).getByRole("button", { name: "Show part.dxf" }));
    expect(store.getState().document.drawings[0]?.hidden).toBeUndefined();
  });

  it("marks what the selected operation cuts", () => {
    const { workspace } = render();
    fireEvent.keyDown(row("part.dxf"), { key: "ArrowRight" });
    expect(screen.queryAllByLabelText("Cut by the selected operation")).toHaveLength(0);
    act(() => workspace.getState().selectOperation(OPERATION_ID));
    // The profile cuts the whole square and the circle, so the drawing too.
    expect(screen.getAllByLabelText("Cut by the selected operation")).toHaveLength(3);
  });

  it("selects a drawing as the viewport does, leaving out a shape locked on its own", () => {
    const { store, workspace } = render();
    act(() => setObjectFlag(store, CIRCLE_ID, "locked", true));
    fireEvent.click(row("part.dxf"));
    expect(workspace.getState().selectedPaths).toEqual([square0, square1]);
    expect(row("part.dxf").getAttribute("aria-selected")).toBe("true");
    // Locking the drawing itself locks them all, and the row selects them all.
    act(() => setObjectFlag(store, DRAWING_ID, "locked", true));
    fireEvent.click(row("part.dxf"));
    expect(workspace.getState().selectedPaths).toEqual([square0, square1, circle0]);
  });

  it("marks a drawing holding part of the selection, and leaves the selection alone on an empty row", () => {
    const { store, workspace } = render();
    act(() => workspace.getState().selectPaths([circle0]));
    expect(row("part.dxf").getAttribute("aria-selected")).toBe("false");
    expect(row("part.dxf").className).toContain("bg-accent/40");

    act(() => {
      setObjectFlag(store, SQUARE_ID, "hidden", true);
      setObjectFlag(store, CIRCLE_ID, "hidden", true);
      workspace.getState().selectModel(model.id);
    });
    expect(row("part.dxf").getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(row("part.dxf"));
    expect(workspace.getState().selectedModelId).toBe(model.id);
  });

  it("keeps the paths selected on a Shift+click of the model, as the viewport does", () => {
    const { workspace } = render();
    fireEvent.click(row("part.dxf"));
    fireEvent.click(row(model.fileName), { shiftKey: true });
    expect(workspace.getState()).toMatchObject({
      selectedModelId: null,
      selectedPaths: [square0, square1, circle0],
    });
  });

  it("shows a shape's eye and lock as its drawing's, and not pressable, while the drawing has them", () => {
    const { store } = render();
    fireEvent.keyDown(row("part.dxf"), { key: "ArrowRight" });
    act(() => setObjectFlag(store, DRAWING_ID, "hidden", true));
    const eye = within(row("Hole")).getByRole("button", { name: "Show Hole" }) as HTMLButtonElement;
    expect(eye.disabled).toBe(true);
    expect(eye.getAttribute("aria-pressed")).toBe("true");
    const lock = within(row("Hole")).getByRole("button", {
      name: "Lock Hole",
    }) as HTMLButtonElement;
    expect(lock.disabled).toBe(false);
  });

  it("keeps the focus in the tree when the chevron closes the row holding it", () => {
    render();
    fireEvent.keyDown(row("part.dxf"), { key: "ArrowRight" });
    act(() => row("Hole").focus());
    const chevron = row("part.dxf").querySelector("svg");
    if (!chevron) throw new Error("no chevron");
    fireEvent.click(chevron);
    expect(document.activeElement).toBe(row("part.dxf"));
  });

  it("downloads a model's stored mesh as STL from its row only", async () => {
    const { host } = render();
    const bytes = new Uint8Array([1, 2, 3]);
    host.stored.meshes.set(model.sha256, bytes.buffer);
    expect(screen.getAllByRole("button", { name: /^Download / })).toHaveLength(1);
    fireEvent.click(within(row(model.fileName)).getByRole("button", { name: /^Download / }));
    await waitFor(() => expect(download).toHaveBeenCalledOnce());
    expect(download).toHaveBeenCalledWith(bytes, "emblem.stl", "model/stl");
  });

  it("says so when the mesh can't be read", async () => {
    render();
    fireEvent.click(screen.getByRole("button", { name: /^Download / }));
    expect(await screen.findByText("This model is missing.")).toBeTruthy();
  });

  it("deletes a drawing or the model from its row, as one undo step, without selecting it", () => {
    const { store, workspace } = render();
    const operations = store.getState().document.operations.length;
    // Shapes and paths have no delete button.
    fireEvent.keyDown(row("part.dxf"), { key: "ArrowRight" });
    fireEvent.keyDown(row("Square"), { key: "ArrowRight" });
    expect(screen.getAllByRole("button", { name: /^Delete / })).toHaveLength(2);
    const remove = within(row("part.dxf")).getByRole("button", { name: "Delete part.dxf" });
    expect(remove.getAttribute("title")).toMatch(/^Delete part\.dxf\. Also removes the operation/);

    fireEvent.click(remove);
    expect(store.getState().document.drawings).toEqual([]);
    expect(store.getState().document.operations.length).toBeLessThan(operations);
    expect(workspace.getState().selectedPaths).toEqual([]);
    act(() => store.getState().undo());
    expect(store.getState().document.drawings).toHaveLength(1);
    expect(store.getState().document.operations).toHaveLength(operations);

    fireEvent.click(screen.getByRole("button", { name: `Delete ${model.fileName}` }));
    expect(store.getState().document.models).toEqual([]);
    expect(workspace.getState().selectedModelId).toBeNull();
    act(() => store.getState().undo());
    expect(store.getState().document.models).toEqual([model]);
  });

  it("moves the focus to the next row, else the previous one, after a delete", () => {
    const { store } = render();
    fireEvent.click(screen.getByRole("button", { name: `Delete ${model.fileName}` }));
    expect(document.activeElement).toBe(row("part.dxf"));
    act(() => store.getState().undo());
    fireEvent.click(screen.getByRole("button", { name: "Delete part.dxf" }));
    expect(document.activeElement).toBe(row(model.fileName));
  });

  it("names the download after the model with an .stl extension", () => {
    expect(stlFileName("part.step")).toBe("part.stl");
    expect(stlFileName("part.STL")).toBe("part.stl");
    expect(stlFileName("my.part.stp")).toBe("my.part.stl");
    expect(stlFileName("terrain")).toBe("terrain.stl");
  });
});
