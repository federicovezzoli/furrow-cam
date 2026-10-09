import { devtools } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import { createStore } from "zustand/vanilla";

/**
 * Session state of the workspace (ADR-0010): never undoable, never saved.
 * Viewport mode and camera join it with the viewport (#16).
 *
 * Ids may outlive what they point at (an undo can remove a selected shape), so
 * readers skip ids that are no longer in the document.
 */
export type WorkspaceState = {
  selectedShapeIds: string[];
  selectedOperationId: string | null;
  hoveredShapeId: string | null;

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
        selectedShapeIds: [],
        selectedOperationId: null,
        hoveredShapeId: null,

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
