import type { ProjectDocument } from "@furrow/document";
import { devtools } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import { createStore } from "zustand/vanilla";

/** Orthographic top view for setup and editing, or perspective orbit view (ADR-0008). */
export type ViewMode = "top" | "orbit";

/**
 * Session state of the workspace (ADR-0010): never undoable, never saved.
 * The camera pose stays inside the viewport, which its controls change on
 * every pointer move.
 *
 * An undo can remove a selected shape or operation, so `prune` drops ids that
 * are no longer in the document, and ends editing tabs the selected profile
 * no longer has; the workspace calls it on every document change, and readers
 * can trust the ids.
 */
export type WorkspaceState = {
  view: ViewMode;
  selectedShapeIds: string[];
  selectedOperationId: string | null;
  hoveredShapeId: string | null;
  /**
   * Editing the selected profile's tabs in the viewport. Only in the top
   * view, and ends when the selection or the view changes.
   */
  editingTabs: boolean;

  setView: (view: ViewMode) => void;
  /** `replace` selects only `ids`; `toggle` flips each of them (Ctrl/Cmd/Shift+click). */
  selectShapes: (ids: string[], mode?: "replace" | "toggle") => void;
  selectOperation: (id: string | null) => void;
  setHoveredShape: (id: string | null) => void;
  /** Switches to the top view when turned on. */
  setEditingTabs: (editing: boolean) => void;
  clearSelection: () => void;
  /** Drops selected and hovered ids that aren't in `document`, and tab editing without tabs. */
  prune: (document: ProjectDocument) => void;
};

export type WorkspaceStore = ReturnType<typeof createWorkspaceStore>;

export function createWorkspaceStore() {
  return createStore<WorkspaceState>()(
    devtools(
      immer((set) => ({
        view: "top",
        selectedShapeIds: [],
        selectedOperationId: null,
        hoveredShapeId: null,
        editingTabs: false,

        setView(view) {
          set(
            (state) => {
              state.view = view;
              if (view !== "top") state.editingTabs = false;
            },
            false,
            "setView",
          );
        },

        selectShapes(ids, mode = "replace") {
          set(
            (state) => {
              if (mode === "replace") {
                state.selectedShapeIds = [...new Set(ids)];
                return;
              }
              const selected = new Set(state.selectedShapeIds);
              for (const id of new Set(ids)) {
                if (selected.has(id)) selected.delete(id);
                else selected.add(id);
              }
              state.selectedShapeIds = [...selected];
            },
            false,
            "selectShapes",
          );
        },

        selectOperation(id) {
          set(
            (state) => {
              if (state.selectedOperationId !== id) state.editingTabs = false;
              state.selectedOperationId = id;
            },
            false,
            "selectOperation",
          );
        },

        setHoveredShape(id) {
          set(
            (state) => {
              state.hoveredShapeId = id;
            },
            false,
            "setHoveredShape",
          );
        },

        setEditingTabs(editing) {
          set(
            (state) => {
              state.editingTabs = editing;
              if (editing) state.view = "top";
            },
            false,
            "setEditingTabs",
          );
        },

        clearSelection() {
          set(
            (state) => {
              state.selectedShapeIds = [];
              state.selectedOperationId = null;
              state.editingTabs = false;
            },
            false,
            "clearSelection",
          );
        },

        prune(document) {
          set(
            (state) => {
              const shapeIds = new Set(document.geometry.map((shape) => shape.id));
              // Assigned only when something went, so unchanged selections keep their identity.
              if (state.selectedShapeIds.some((id) => !shapeIds.has(id))) {
                state.selectedShapeIds = state.selectedShapeIds.filter((id) => shapeIds.has(id));
              }
              if (state.hoveredShapeId !== null && !shapeIds.has(state.hoveredShapeId)) {
                state.hoveredShapeId = null;
              }
              const operationId = state.selectedOperationId;
              const operation = document.operations.find(({ id }) => id === operationId);
              if (operationId !== null && !operation) state.selectedOperationId = null;
              // Nothing left to edit once the profile's tabs are turned off (or undone).
              if (state.editingTabs && !(operation?.type === "profile" && operation.params.tabs)) {
                state.editingTabs = false;
              }
            },
            false,
            "prune",
          );
        },
      })),
      { name: "workspace", enabled: process.env.NODE_ENV !== "production" },
    ),
  );
}
