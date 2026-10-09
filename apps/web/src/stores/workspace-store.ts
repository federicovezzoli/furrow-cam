import { devtools } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import { createStore } from "zustand/vanilla";

/**
 * Session state of the workspace (ADR-0010): never undoable, never saved.
 * The camera itself stays inside the viewport, which moves it every frame.
 *
 * Ids may outlive what they point at (an undo can remove a selected shape), so
 * readers skip ids that are no longer in the document.
 */
/** Orthographic top view for setup and editing, or perspective orbit view (ADR-0008). */
export type ViewMode = "top" | "orbit";

export type WorkspaceState = {
  view: ViewMode;
  selectedShapeIds: string[];
  selectedOperationId: string | null;
  hoveredShapeId: string | null;

  setView: (view: ViewMode) => void;
  /** `replace` selects only `ids`; `toggle` flips each of them (Ctrl/Cmd/Shift+click). */
  selectShapes: (ids: string[], mode?: "replace" | "toggle") => void;
  selectOperation: (id: string | null) => void;
  setHoveredShape: (id: string | null) => void;
  clearSelection: () => void;
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

        setView(view) {
          set(
            (state) => {
              state.view = view;
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

        clearSelection() {
          set(
            (state) => {
              state.selectedShapeIds = [];
              state.selectedOperationId = null;
            },
            false,
            "clearSelection",
          );
        },
      })),
      { name: "workspace", enabled: process.env.NODE_ENV !== "production" },
    ),
  );
}
