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
 * are no longer in the document (selected, hovered and hidden ones), ends
 * editing tabs the selected profile no longer has and ends picking the zero
 * once it isn't custom; the workspace calls it on every document change, and
 * readers can trust the ids.
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
  /**
   * Picking the XY zero in the viewport (PRD-0002 Z5), from the stock
   * properties. Only in the top view and while nothing is selected (the stock
   * properties show then), and never while editing tabs: each mode ends the
   * other.
   */
  pickingZero: boolean;
  /** Operations whose toolpaths the viewport hides. */
  hiddenToolpathIds: string[];

  setView: (view: ViewMode) => void;
  /** `replace` selects only `ids`; `toggle` flips each of them (Ctrl/Cmd/Shift+click). */
  selectShapes: (ids: string[], mode?: "replace" | "toggle") => void;
  selectOperation: (id: string | null) => void;
  setHoveredShape: (id: string | null) => void;
  /** Switches to the top view when turned on. */
  setEditingTabs: (editing: boolean) => void;
  /** Switches to the top view when turned on. */
  setPickingZero: (picking: boolean) => void;
  setToolpathVisible: (operationId: string, visible: boolean) => void;
  clearSelection: () => void;
  /**
   * Drops selected, hovered and hidden ids that aren't in `document`, tab
   * editing without tabs and picking the zero without a custom zero.
   */
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
        pickingZero: false,
        hiddenToolpathIds: [],

        setView(view) {
          set(
            (state) => {
              state.view = view;
              if (view !== "top") {
                state.editingTabs = false;
                state.pickingZero = false;
              }
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
                if (ids.length > 0) state.pickingZero = false;
                return;
              }
              const selected = new Set(state.selectedShapeIds);
              for (const id of new Set(ids)) {
                if (selected.has(id)) selected.delete(id);
                else selected.add(id);
              }
              state.selectedShapeIds = [...selected];
              if (selected.size > 0) state.pickingZero = false;
            },
            false,
            "selectShapes",
          );
        },

        selectOperation(id) {
          set(
            (state) => {
              if (state.selectedOperationId !== id) state.editingTabs = false;
              if (id !== null) state.pickingZero = false;
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
              if (editing) {
                state.view = "top";
                state.pickingZero = false;
              }
            },
            false,
            "setEditingTabs",
          );
        },

        setPickingZero(picking) {
          set(
            (state) => {
              state.pickingZero = picking;
              if (picking) {
                state.view = "top";
                state.editingTabs = false;
              }
            },
            false,
            "setPickingZero",
          );
        },

        setToolpathVisible(operationId, visible) {
          set(
            (state) => {
              const hidden = state.hiddenToolpathIds.includes(operationId);
              if (visible && hidden) {
                state.hiddenToolpathIds = state.hiddenToolpathIds.filter(
                  (id) => id !== operationId,
                );
              } else if (!visible && !hidden) {
                state.hiddenToolpathIds.push(operationId);
              }
            },
            false,
            "setToolpathVisible",
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
              const operationIds = new Set(document.operations.map(({ id }) => id));
              if (state.hiddenToolpathIds.some((id) => !operationIds.has(id))) {
                state.hiddenToolpathIds = state.hiddenToolpathIds.filter((id) =>
                  operationIds.has(id),
                );
              }
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
              // The pick button goes with the custom zero (an undo, an anchor chosen).
              if (state.pickingZero && document.stock.xyOrigin.anchor !== "custom") {
                state.pickingZero = false;
              }
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
