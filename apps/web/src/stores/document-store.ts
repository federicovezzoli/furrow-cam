import type { ProjectDocument } from "@furrow/document";
import { applyPatches, type Draft, enablePatches, type Patch, produceWithPatches } from "immer";
import { devtools } from "zustand/middleware";
import { createStore } from "zustand/vanilla";

enablePatches();

/** One undo step: `patches` redo it, `inversePatches` undo it. */
export type HistoryEntry = { patches: Patch[]; inversePatches: Patch[] };

/** Undo steps kept; older ones are dropped. */
export const MAX_HISTORY = 200;

export type DocumentState = {
  /** The open project's document (ADR-0003), always valid for the current schema version. */
  document: ProjectDocument;
  /** Undo steps, oldest first. */
  past: HistoryEntry[];
  /** Redo steps, the next one last. Cleared by any new change. */
  future: HistoryEntry[];
  /**
   * Changes made since `beginTransaction`, already applied to `document` but
   * not yet in `past`; `null` outside a transaction.
   */
  transaction: HistoryEntry | null;

  /**
   * Applies `recipe` to the document as one undo step, or as part of the open
   * transaction. Feature actions (edit stock, add operation, …) are built on
   * this; components call those, never `setState` (ADR-0010).
   */
  change: (name: string, recipe: (draft: Draft<ProjectDocument>) => void) => void;
  /**
   * Starts a continuous gesture (dragging, scrubbing a value): its changes show
   * live but become a single undo step on `commitTransaction`. Does nothing if
   * one is already open.
   */
  beginTransaction: () => void;
  commitTransaction: () => void;
  /** Reverts the open transaction's changes, e.g. when a drag is cancelled with Escape. */
  cancelTransaction: () => void;
  /** Undo and redo do nothing mid-transaction. */
  undo: () => void;
  redo: () => void;
};

export type DocumentStore = ReturnType<typeof createDocumentStore>;

/** A document store for one open project, with an empty history. */
export function createDocumentStore(document: ProjectDocument) {
  return createStore<DocumentState>()(
    devtools(
      (set, get) => ({
        document,
        past: [],
        future: [],
        transaction: null,

        change(name, recipe) {
          const { document, past, transaction } = get();
          const [next, patches, inversePatches] = produceWithPatches(document, recipe);
          if (patches.length === 0) return;
          if (transaction) {
            set(
              { document: next, transaction: merge(transaction, { patches, inversePatches }) },
              false,
              name,
            );
          } else {
            set(
              {
                document: next,
                past: [...past, { patches, inversePatches }].slice(-MAX_HISTORY),
                future: [],
              },
              false,
              name,
            );
          }
        },

        beginTransaction() {
          if (get().transaction) return;
          set({ transaction: { patches: [], inversePatches: [] } }, false, "beginTransaction");
        },

        commitTransaction() {
          const { past, transaction } = get();
          if (!transaction) return;
          if (transaction.patches.length === 0) {
            set({ transaction: null }, false, "commitTransaction");
            return;
          }
          set(
            { past: [...past, transaction].slice(-MAX_HISTORY), future: [], transaction: null },
            false,
            "commitTransaction",
          );
        },

        cancelTransaction() {
          const { document, transaction } = get();
          if (!transaction) return;
          set(
            { document: applyPatches(document, transaction.inversePatches), transaction: null },
            false,
            "cancelTransaction",
          );
        },

        undo() {
          const { document, past, future, transaction } = get();
          const entry = past.at(-1);
          if (transaction || !entry) return;
          set(
            {
              document: applyPatches(document, entry.inversePatches),
              past: past.slice(0, -1),
              future: [...future, entry],
            },
            false,
            "undo",
          );
        },

        redo() {
          const { document, past, future, transaction } = get();
          const entry = future.at(-1);
          if (transaction || !entry) return;
          set(
            {
              document: applyPatches(document, entry.patches),
              past: [...past, entry],
              future: future.slice(0, -1),
            },
            false,
            "redo",
          );
        },
      }),
      { name: "document", enabled: process.env.NODE_ENV !== "production" },
    ),
  );
}

/** `first` then `second` as one step: redo in order, undo in reverse order. */
function merge(first: HistoryEntry, second: HistoryEntry): HistoryEntry {
  return {
    patches: [...first.patches, ...second.patches],
    inversePatches: [...second.inversePatches, ...first.inversePatches],
  };
}
