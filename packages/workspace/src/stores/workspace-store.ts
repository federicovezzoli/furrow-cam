import { type PathRef, pathKey } from "@furrow/cam-core";
import type { ProjectDocument, StockSide } from "@furrow/document";
import type { Translatable } from "@furrow/ui/lib/i18n";
import { devtools } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import { createStore } from "zustand/vanilla";

/** Orthographic top view for setup and editing, or perspective orbit view (ADR-0008). */
export type ViewMode = "top" | "orbit";

/** The path the pointer is over in the viewport. */
export type HoveredGeometry = { shapeId: string; path: number };

/** An STL file being imported, or why it couldn't be (PRD-0005 S1). */
export type ModelImport = { fileName: string; error: Translatable | null };

/** What the viewport edits on the selected operation. */
export type EditMode = "tabs" | "startPoints" | "overcuts";

/**
 * Session state of the workspace (ADR-0010): never undoable, never saved.
 * The camera pose stays inside the viewport, which its controls change on
 * every pointer move.
 *
 * Selection is by path (ADR-0018): selecting a shape selects all its paths.
 * A 3D model is selected on its own, which drops the selected paths, and
 * selecting paths drops it. An undo can remove a selected shape, model or operation, so `prune` drops ids and
 * paths that are no longer in the document (selected, hovered and hidden
 * ones), ends
 * editing tabs the selected profile no longer has and ends picking the zero
 * once it isn't custom; the workspace calls it on every document change, and
 * readers can trust the ids.
 */
export type WorkspaceState = {
  view: ViewMode;
  /**
   * The side of a two-sided project the viewport shows (ADR-0060), which new
   * operations go on. The bottom side is for viewing: editing tabs and
   * picking the zero are top-side only, so each ends the other.
   */
  side: StockSide;
  /** In the order they were selected. */
  selectedPaths: PathRef[];
  /**
   * The 3D model whose placement floats over the viewport (PRD-0005 S2). It
   * takes the place of the selected operation's panel: selecting one drops
   * the other.
   */
  selectedModelId: string | null;
  selectedOperationId: string | null;
  hovered: HoveredGeometry | null;
  /**
   * Editing the selected profile's tabs or corner overcuts (#428), or the
   * selected profile's or engraving's start points (#426), in the viewport. Only in the top view,
   * and ends when the selection or the view changes.
   */
  editing: EditMode | null;
  /**
   * A tab or start point marker under the pointer (`grab`) or being dragged
   * (`grabbing`), or an overcut marker, which only takes clicks (`pointer`).
   */
  markerCursor: "grab" | "grabbing" | "pointer" | null;
  /**
   * Picking the XY zero in the viewport (PRD-0002 Z5), from the stock
   * properties. Only in the top view and while nothing is selected (the stock
   * properties show then), and never while editing tabs: each mode ends the
   * other.
   */
  pickingZero: boolean;
  /** Operations whose toolpaths the viewport hides. */
  hiddenToolpathIds: string[];
  /**
   * The viewport shows the stock as simulated after cutting (PRD-0001 R10,
   * ADR-0019) in place of the stock box; toolpaths still show. Editing tabs
   * and picking the zero work on the uncut stock top, so each ends the other.
   */
  simulating: boolean;
  /** The viewport shows a two-sided project's parting plane (#473). */
  showParting: boolean;
  /** The STL import under way or the last one that failed, `null` once done or dismissed. */
  modelImport: ModelImport | null;

  setView: (view: ViewMode) => void;
  setSide: (side: StockSide) => void;
  /**
   * `replace` selects only `paths`; `toggle` (Ctrl/Cmd/Shift+click) deselects
   * them if all are selected, otherwise adds the others.
   */
  selectPaths: (paths: PathRef[], mode?: "replace" | "toggle") => void;
  selectModel: (id: string | null) => void;
  selectOperation: (id: string | null) => void;
  setHovered: (hovered: HoveredGeometry | null) => void;
  /** Switches to the top view when turned on. */
  setEditing: (editing: EditMode | null) => void;
  setMarkerCursor: (cursor: WorkspaceState["markerCursor"]) => void;
  /** Switches to the top view when turned on. */
  setPickingZero: (picking: boolean) => void;
  setToolpathVisible: (operationId: string, visible: boolean) => void;
  /** Shows or hides the toolpaths of all of `operationIds` at once. */
  setToolpathsVisible: (operationIds: string[], visible: boolean) => void;
  setSimulating: (simulating: boolean) => void;
  setShowParting: (show: boolean) => void;
  setModelImport: (modelImport: ModelImport | null) => void;
  clearSelection: () => void;
  /**
   * Drops selected, hovered and hidden ids and paths that aren't in `document`, tab
   * editing without tabs, start point editing without a profile or engraving, overcut
   * editing without overcuts, picking the zero without a custom zero and the
   * bottom side of a project no longer two-sided.
   */
  prune: (document: ProjectDocument) => void;
};

export type WorkspaceStore = ReturnType<typeof createWorkspaceStore>;

export function createWorkspaceStore() {
  return createStore<WorkspaceState>()(
    devtools(
      immer((set) => ({
        view: "top",
        side: "top",
        selectedPaths: [],
        selectedModelId: null,
        selectedOperationId: null,
        hovered: null,
        editing: null,
        markerCursor: null,
        pickingZero: false,
        hiddenToolpathIds: [],
        simulating: false,
        showParting: true,
        modelImport: null,

        setView(view) {
          set(
            (state) => {
              state.view = view;
              if (view !== "top") {
                state.editing = null;
                state.pickingZero = false;
              }
            },
            false,
            "setView",
          );
        },

        setSide(side) {
          set(
            (state) => {
              state.side = side;
              if (side === "bottom") {
                state.editing = null;
                state.pickingZero = false;
              }
            },
            false,
            "setSide",
          );
        },

        selectPaths(paths, mode = "replace") {
          set(
            (state) => {
              const unique = new Map(paths.map((path) => [pathKey(path), path]));
              if (mode === "replace") {
                state.selectedPaths = [...unique.values()];
              } else {
                const selected = new Map(state.selectedPaths.map((path) => [pathKey(path), path]));
                const deselect = [...unique.keys()].every((key) => selected.has(key));
                for (const [key, path] of unique) {
                  if (deselect) selected.delete(key);
                  else selected.set(key, path);
                }
                state.selectedPaths = [...selected.values()];
              }
              state.selectedModelId = null;
              if (state.selectedPaths.length > 0) state.pickingZero = false;
            },
            false,
            "selectPaths",
          );
        },

        selectModel(id) {
          set(
            (state) => {
              state.selectedModelId = id;
              if (id !== null) {
                state.selectedPaths = [];
                state.pickingZero = false;
                state.selectedOperationId = null;
                state.editing = null;
              }
            },
            false,
            "selectModel",
          );
        },

        selectOperation(id) {
          set(
            (state) => {
              if (state.selectedOperationId !== id) state.editing = null;
              if (id !== null) {
                state.pickingZero = false;
                state.selectedModelId = null;
              }
              state.selectedOperationId = id;
            },
            false,
            "selectOperation",
          );
        },

        setHovered(hovered) {
          set(
            (state) => {
              state.hovered = hovered;
            },
            false,
            "setHovered",
          );
        },

        setEditing(editing) {
          set(
            (state) => {
              state.editing = editing;
              if (editing) {
                state.view = "top";
                state.side = "top";
                state.pickingZero = false;
                state.simulating = false;
              }
            },
            false,
            "setEditing",
          );
        },

        setMarkerCursor(cursor) {
          set(
            (state) => {
              state.markerCursor = cursor;
            },
            false,
            "setMarkerCursor",
          );
        },

        setPickingZero(picking) {
          set(
            (state) => {
              state.pickingZero = picking;
              if (picking) {
                state.view = "top";
                state.side = "top";
                state.editing = null;
                state.simulating = false;
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

        setToolpathsVisible(operationIds, visible) {
          set(
            (state) => {
              const ids = new Set(operationIds);
              const kept = state.hiddenToolpathIds.filter((id) => !ids.has(id));
              state.hiddenToolpathIds = visible ? kept : [...kept, ...ids];
            },
            false,
            "setToolpathsVisible",
          );
        },

        setSimulating(simulating) {
          set(
            (state) => {
              state.simulating = simulating;
              if (simulating) {
                state.editing = null;
                state.pickingZero = false;
              }
            },
            false,
            "setSimulating",
          );
        },

        setShowParting(show) {
          set(
            (state) => {
              state.showParting = show;
            },
            false,
            "setShowParting",
          );
        },

        setModelImport(modelImport) {
          set(
            (state) => {
              state.modelImport = modelImport;
            },
            false,
            "setModelImport",
          );
        },

        clearSelection() {
          set(
            (state) => {
              state.selectedPaths = [];
              state.selectedModelId = null;
              state.selectedOperationId = null;
              state.editing = null;
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
              const pathCounts = new Map(
                document.geometry.map((shape) => [shape.id, shape.paths.length]),
              );
              const exists = ({ shapeId, path }: HoveredGeometry) => {
                const count = pathCounts.get(shapeId);
                return count !== undefined && path < count;
              };
              // Assigned only when something went, so unchanged selections keep their identity.
              if (!state.selectedPaths.every(exists)) {
                state.selectedPaths = state.selectedPaths.filter(exists);
              }
              if (state.hovered !== null && !exists(state.hovered)) state.hovered = null;
              const modelId = state.selectedModelId;
              if (modelId !== null && !document.models.some(({ id }) => id === modelId)) {
                state.selectedModelId = null;
              }
              const operationId = state.selectedOperationId;
              const operation = document.operations.find(({ id }) => id === operationId);
              if (operationId !== null && !operation) state.selectedOperationId = null;
              // The pick button goes with the custom zero (an undo, an anchor chosen).
              if (state.pickingZero && document.stock.xyOrigin.anchor !== "custom") {
                state.pickingZero = false;
              }
              if (state.side === "bottom" && !document.stock.twoSided) state.side = "top";
              // Nothing left to edit once the profile's tabs are turned off (or undone).
              if (
                state.editing === "tabs" &&
                !(operation?.type === "profile" && operation.params.tabs)
              ) {
                state.editing = null;
              }
              if (
                state.editing === "overcuts" &&
                !(operation?.type === "profile" && operation.params.cornerOvercuts)
              ) {
                state.editing = null;
              }
              if (
                state.editing === "startPoints" &&
                operation?.type !== "profile" &&
                operation?.type !== "engrave"
              ) {
                state.editing = null;
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
