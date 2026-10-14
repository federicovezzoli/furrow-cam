import type { ToolpathLines } from "@furrow/cam-core";
import { devtools } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import { createStore } from "zustand/vanilla";

/**
 * What the workspace shows of a toolpath: its warnings and its lines in the
 * viewport, with those of its clearing moves (ADR-0026) if it has any. The
 * moves stay in the worker (ADR-0004).
 */
export type ToolpathPreview = {
  warnings: string[];
  lines: ToolpathLines;
  clearing?: ToolpathLines;
};

/**
 * A toolpath computed in a worker (ADR-0004) for one operation. `inputHash`
 * identifies the inputs it was computed from (the operation, its shapes, tool
 * and retract height), so an entry is stale once the hash of the current
 * inputs differs. `lines` (and `clearing`) are the toolpath as the viewport
 * draws it; while an operation recomputes it keeps those of its last
 * toolpath, so the preview doesn't flicker while a value is scrubbed.
 */
export type ToolpathEntry = { inputHash: string } & (
  | { status: "computing"; lines?: ToolpathLines; clearing?: ToolpathLines }
  | ({ status: "ready" } & ToolpathPreview)
  | { status: "error"; error: string }
);

/** Derived data (ADR-0010): never undoable, never saved. */
export type ToolpathState = {
  /** Operation id → its latest toolpath. */
  entries: Record<string, ToolpathEntry>;

  startComputing: (operationId: string, inputHash: string) => void;
  /** Results for inputs other than the latest `startComputing` are stale and dropped. */
  setResult: (operationId: string, inputHash: string, preview: ToolpathPreview) => void;
  setError: (operationId: string, inputHash: string, error: string) => void;
  /** Drops entries of operations that are no longer in the document. */
  retain: (operationIds: Iterable<string>) => void;
};

export type ToolpathStore = ReturnType<typeof createToolpathStore>;

export function createToolpathStore() {
  return createStore<ToolpathState>()(
    devtools(
      immer((set) => ({
        entries: {},

        startComputing(operationId, inputHash) {
          set(
            (state) => {
              const previous = state.entries[operationId];
              const kept = previous?.status === "error" ? undefined : previous;
              const { lines, clearing } = kept ?? {};
              state.entries[operationId] = {
                inputHash,
                status: "computing",
                ...(lines && { lines }),
                ...(lines && clearing && { clearing }),
              };
            },
            false,
            "startComputing",
          );
        },

        setResult(operationId, inputHash, preview) {
          set(
            (state) => {
              if (state.entries[operationId]?.inputHash !== inputHash) return;
              state.entries[operationId] = { inputHash, status: "ready", ...preview };
            },
            false,
            "setResult",
          );
        },

        setError(operationId, inputHash, error) {
          set(
            (state) => {
              if (state.entries[operationId]?.inputHash !== inputHash) return;
              state.entries[operationId] = { inputHash, status: "error", error };
            },
            false,
            "setError",
          );
        },

        retain(operationIds) {
          set(
            (state) => {
              const keep = new Set(operationIds);
              for (const id of Object.keys(state.entries)) {
                if (!keep.has(id)) delete state.entries[id];
              }
            },
            false,
            "retain",
          );
        },
      })),
      { name: "toolpaths", enabled: process.env.NODE_ENV !== "production" },
    ),
  );
}
