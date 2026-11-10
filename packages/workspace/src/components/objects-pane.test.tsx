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
import { act, fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createMemoryHost } from "../lib/memory-host";
import { useDocumentStoreApi, useWorkspaceStoreApi } from "../providers/workspace-stores";
import type { DocumentStore } from "../stores/document-store";
import { setObjectFlag } from "../stores/geometry-actions";
import type { WorkspaceStore } from "../stores/workspace-store";
import { renderWorkspace } from "../test-render";
import { ObjectsPane } from "./objects-pane";

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
  renderWorkspace(
    <>
      <ObjectsPane />
      <Probe seen={seen} />
    </>,
    createMemoryHost({ document: doc }),
  );
  return seen as { store: DocumentStore; workspace: WorkspaceStore };
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
});
