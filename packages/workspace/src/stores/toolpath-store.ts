import type { ToolpathLines, ToolpathMessage } from "@furrow/cam-core";
import { devtools } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import { createStore } from "zustand/vanilla";
import type { GcodeExportResult } from "./toolpath-scheduler";

/**
 * What the workspace shows of a toolpath: its warnings and its lines in the
 * viewport, with those of its clearing moves (ADR-0026) if it has any. The
 * moves stay in the worker (ADR-0004).
 */
export type ToolpathPreview = {
  warnings: ToolpathMessage[];
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
 * `previewKey` says what the lines look like: they are kept only for inputs
 * with the same key, so a toolpath laid out differently (another strategy,
 * say) doesn't show the old one until it is ready.
 */
export type ToolpathEntry = { inputHash: string; previewKey?: string } & (
  | {
      status: "computing";
      lines?: ToolpathLines;
      clearing?: ToolpathLines;
      /** How much is done, from 0 to 1, for toolpaths that report it (3D operations). */
      progress?: number;
    }
  | ({ status: "ready" } & ToolpathPreview)
  /** `cancelled` when it was stopped before it finished, rather than failing. */
  | { status: "error"; error: string; cancelled?: boolean }
);

/**
 * Stops or restarts computing an operation's toolpath, and exports the
 * program from the toolpaths computed (#133); the workspace's scheduler
 * provides them.
 */
export type ToolpathControls = {
  cancel: (operationId: string) => void;
  retry: (operationId: string) => void;
  /** `name` is the project's, read at each attempt. */
  exportGcode: (name: () => string) => Promise<GcodeExportResult>;
};

/** What a cancelled toolpath says. */
export const CANCELLED = "cancelled";

/** Derived data (ADR-0010): never undoable, never saved. */
export type ToolpathState = {
  /** Operation id → its latest toolpath. */
  entries: Record<string, ToolpathEntry>;

  /** Lines of the last toolpath are kept if it had the same `previewKey`. */
  startComputing: (operationId: string, inputHash: string, previewKey?: string) => void;
  /** Results for inputs other than the latest `startComputing` are stale and dropped. */
  setResult: (operationId: string, inputHash: string, preview: ToolpathPreview) => void;
  setError: (operationId: string, inputHash: string, error: string) => void;
  setProgress: (operationId: string, inputHash: string, progress: number) => void;
  setCancelled: (operationId: string, inputHash: string) => void;
  /** Drops entries of operations that are no longer in the document. */
  retain: (operationIds: Iterable<string>) => void;
  /** No-ops until the scheduler sets them (`setControls`). */
  controls: ToolpathControls;
  setControls: (controls: ToolpathControls | null) => void;
};

export type ToolpathStore = ReturnType<typeof createToolpathStore>;

const NO_CONTROLS: ToolpathControls = {
  cancel() {},
  retry() {},
  exportGcode: async () => ({ error: { code: "workspace.toolpathsOff" } }),
};

/**
 * The state as Redux DevTools shows it: typed arrays (a 3D finish's lines run
 * to tens of megabytes) as their length, so recording an action, such as
 * each progress report, doesn't serialise them.
 */
export function sanitizeForDevtools(state: unknown): unknown {
  return JSON.parse(
    JSON.stringify(state, (_, value) =>
      ArrayBuffer.isView(value)
        ? `${value.constructor.name}(${(value as Float32Array).length})`
        : value,
    ),
  );
}

export function createToolpathStore() {
  return createStore<ToolpathState>()(
    devtools(
      immer((set) => ({
        entries: {},

        startComputing(operationId, inputHash, previewKey) {
          set(
            (state) => {
              const previous = state.entries[operationId];
              const kept =
                previous?.status === "error" || previous?.previewKey !== previewKey
                  ? undefined
                  : previous;
              const { lines, clearing } = kept ?? {};
              state.entries[operationId] = {
                inputHash,
                ...(previewKey !== undefined && { previewKey }),
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
              const entry = state.entries[operationId];
              if (entry?.inputHash !== inputHash) return;
              const { previewKey } = entry;
              state.entries[operationId] = {
                inputHash,
                ...(previewKey !== undefined && { previewKey }),
                status: "ready",
                ...preview,
              };
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

        setProgress(operationId, inputHash, progress) {
          set(
            (state) => {
              const entry = state.entries[operationId];
              if (entry?.inputHash !== inputHash || entry.status !== "computing") return;
              entry.progress = progress;
            },
            false,
            "setProgress",
          );
        },

        setCancelled(operationId, inputHash) {
          set(
            (state) => {
              if (state.entries[operationId]?.inputHash !== inputHash) return;
              state.entries[operationId] = {
                inputHash,
                status: "error",
                error: CANCELLED,
                cancelled: true,
              };
            },
            false,
            "setCancelled",
          );
        },

        controls: NO_CONTROLS,

        setControls(controls) {
          set({ controls: controls ?? NO_CONTROLS }, false, "setControls");
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
      {
        name: "toolpaths",
        enabled: process.env.NODE_ENV !== "production",
        stateSanitizer: sanitizeForDevtools,
      },
    ),
  );
}
