import { devtools } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import { createStore } from "zustand/vanilla";

/**
 * A toolpath computed in a worker (ADR-0004) for one operation. `inputHash`
 * identifies the inputs it was computed from (the operation, its shapes, tool
 * and stock), so an entry is stale once the hash of the current inputs differs.
 * `result` gets its type with toolpath generation (#21).
 */
export type ToolpathEntry = { inputHash: string } & (
  | { status: "computing" }
  | { status: "ready"; result: unknown }
  | { status: "error"; error: string }
);

/** Derived data (ADR-0010): never undoable, never saved. */
export type ToolpathState = {
  /** Operation id → its latest toolpath. */
  entries: Record<string, ToolpathEntry>;

  startComputing: (operationId: string, inputHash: string) => void;
  /** Results for inputs other than the latest `startComputing` are stale and dropped. */
  setResult: (operationId: string, inputHash: string, result: unknown) => void;
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
              state.entries[operationId] = { inputHash, status: "computing" };
            },
            false,
            "startComputing",
          );
        },

        setResult(operationId, inputHash, result) {
          set(
            (state) => {
              if (state.entries[operationId]?.inputHash !== inputHash) return;
              state.entries[operationId] = { inputHash, status: "ready", result };
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
